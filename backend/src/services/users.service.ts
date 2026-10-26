import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import { User, type UserRole, type UserStatus } from "../models/User.model";
import { Invite } from "../models/Invite.model";
import { emailService } from "./email.service";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";
import { GODOWN_ROLES, type searchUsersSchema } from "../validators/users.validators";
import type { z } from "zod";
import { directed, escapeRegex, paginated, pagedAggregate, type SortSpec } from "../utils/crud";

const USER_SORTS: Record<NonNullable<z.infer<typeof searchUsersSchema>["sort"]>, SortSpec> = {
  createdAt: { createdAt: 1 },
  name: { name: 1 },
  email: { email: 1 },
};

type ListedUser = { _id: Types.ObjectId; name: string; email: string; role: UserRole; status: UserStatus };

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const usersService = {
  /**
   * One page of the user-management list: the same godown-only boundary as list(), with the
   * search and paging done in the database. Document counts are fetched for this page's
   * users only, not aggregated across every document in the system.
   */
  async search(input: z.infer<typeof searchUsersSchema>) {
    const match: Record<string, unknown> = { role: { $in: GODOWN_ROLES } };
    if (input.q) {
      const rx = new RegExp(escapeRegex(input.q), "i");
      match.$or = [{ name: rx }, { email: rx }];
    }
    const { items, total } = await pagedAggregate<ListedUser>(User, [{ $match: match }], {
      sort: directed(USER_SORTS[input.sort ?? "createdAt"], input.order),
      page: input.page,
      pageSize: input.pageSize,
      // Explicit: `select: false` on the schema does not apply to an aggregate.
      project: { name: 1, email: 1, role: 1, status: 1 },
    });
    return paginated(
      items.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
      })),
      total,
      input.page,
      input.pageSize,
    );
  },

  // Staff and admin accounts are managed outside this panel, and super_admin never shows
  // up anywhere (see User.model.ts) — so this list is godown roles only, for every caller,
  // not just filtered in the UI. A godown_supervisor now has API access to this same list
  // (see users.routes.ts), so this also doubles as the confidentiality boundary: they must
  // never see a staff/admin/super_admin row even by calling the endpoint directly.
  async list() {
    const users = await User.find({ role: { $in: GODOWN_ROLES } })
      .sort({ createdAt: 1 })
      .lean();
    return users.map((u) => ({
      id: u._id.toString(),
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
    }));
  },

  /**
   * Add a godown user with a password, active straight away — no invite email.
   *
   * Any role that can reach this panel may add either godown role (a supervisor may add
   * another supervisor). An email already in use is refused, except an invite nobody
   * accepted: that pending account is activated with this password instead, and its
   * invite links stop working. Taking over a pending account sets its password, so it
   * follows setPassword's rule: a supervisor may only do it for a pending operator.
   */
  async create(input: { name: string; email: string; role: UserRole; password: string }, actingUserRole: UserRole) {
    const email = input.email.toLowerCase();
    const existing = await User.findOne({ email });
    if (existing && existing.status !== "invited") {
      throw ApiError.conflict("A user with this email already exists");
    }
    if (existing && !GODOWN_ROLES.includes(existing.role as (typeof GODOWN_ROLES)[number])) {
      throw ApiError.forbidden("This account is managed outside this panel");
    }
    if (existing && actingUserRole === "godown_supervisor" && existing.role !== "godown_operator") {
      throw ApiError.forbidden("This email has a pending supervisor invite — only an admin can set its password");
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const user =
      existing ??
      new User({ name: input.name, email, role: input.role });
    user.name = input.name;
    user.role = input.role;
    user.passwordHash = passwordHash;
    user.status = "active";
    await user.save();
    // An unaccepted invite for this email must not be able to set a different password later.
    await Invite.deleteMany({ email });

    return { id: user._id.toString(), name: user.name, email: user.email, role: user.role, status: user.status };
  },

  /**
   * Replace a godown user's password — the old one isn't asked for. A supervisor may only do
   * this for operators; admins and super admins for either godown role. An account still
   * waiting on its invite becomes active, since it now has a password to log in with.
   */
  async setPassword(id: string, password: string, actingUserRole: UserRole) {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest("Invalid user id");
    const user = await User.findById(id);
    if (!user) throw ApiError.notFound("User not found");
    if (!GODOWN_ROLES.includes(user.role as (typeof GODOWN_ROLES)[number])) {
      throw ApiError.forbidden("This account is managed outside this panel");
    }
    if (actingUserRole === "godown_supervisor" && user.role !== "godown_operator") {
      throw ApiError.forbidden("Supervisors can only set an operator's password");
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    if (user.status === "invited") user.status = "active";
    // A reset link already emailed must not be able to override this.
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    await user.save();
    await Invite.deleteMany({ email: user.email });
    return { id: user._id.toString(), status: user.status };
  },

  async invite(input: { name: string; email: string; role: UserRole }, actingUserRole: UserRole) {
    // The validator already restricts role to godown_supervisor/godown_operator for every
    // caller — this narrows it further for a supervisor specifically. Checked here, not in
    // the route, because a route gate never sees the request body.
    if (actingUserRole === "godown_supervisor" && input.role !== "godown_operator") {
      throw ApiError.forbidden("Godown supervisors can only invite godown operators");
    }

    const email = input.email.toLowerCase();
    const existing = await User.findOne({ email });
    if (existing && existing.status !== "invited") {
      throw ApiError.conflict("A user with this email already exists");
    }
    // Same rule as update/remove: an existing row, even one still sitting at "invited",
    // is not this endpoint's to touch once its role is outside what this panel manages.
    if (existing && !GODOWN_ROLES.includes(existing.role as (typeof GODOWN_ROLES)[number])) {
      throw ApiError.forbidden("This account is managed outside this panel");
    }

    const user =
      existing ??
      (await User.create({
        name: input.name,
        email,
        role: input.role,
        status: "invited",
        invitedAt: new Date(),
      }));
    if (existing) {
      existing.name = input.name;
      existing.role = input.role;
      existing.invitedAt = new Date();
      await existing.save();
    }

    const token = crypto.randomBytes(24).toString("hex");
    await Invite.create({
      email,
      name: input.name,
      role: input.role,
      token,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    await emailService.sendInvite(email, input.name, `${env.frontendOrigin}/accept-invite/${token}`);

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    };
  },

  // actingUserId is no longer read: the GODOWN_ROLES scope check below already makes a
  // self-edit unreachable (an admin's own account is role "admin", never a godown role),
  // so the old id-equality check it fed became redundant. Kept in the signature — the
  // controller still passes it — in case a future self-edit exception needs it back.
  async update(id: string, updates: { role?: UserRole; status?: UserStatus }, actingUserRole: UserRole) {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest("Invalid user id");
    const user = await User.findById(id);
    if (!user) throw ApiError.notFound("User not found");
    // The validator already refuses "super_admin" as a value to set — this refuses the
    // account to touch at all, so a super_admin's own role/status can't be edited away
    // through the app either. Both directions have to hold for "Mongo-only" to mean
    // anything.
    if (user.role === "super_admin") {
      throw ApiError.forbidden("Super admin accounts can only be changed directly in the database");
    }
    // Same boundary list()/invite() already hold: this panel reaches godown accounts only.
    // Without this, an admin could PATCH the id of a fellow admin, a staff account, or a
    // store_manager — updateUserSchema's role field only accepts godown_supervisor /
    // godown_operator now, so that call would demote whoever it's pointed at into a godown
    // role, or (role omitted) just suspend them — neither of which this endpoint should be
    // able to reach.
    if (!GODOWN_ROLES.includes(user.role as (typeof GODOWN_ROLES)[number])) {
      throw ApiError.forbidden("This account is managed outside this panel");
    }
    // Same rule as setPassword: a supervisor manages operators, not other supervisors.
    if (actingUserRole === "godown_supervisor" && user.role !== "godown_operator") {
      throw ApiError.forbidden("Supervisors can only edit operators");
    }
    if (updates.role) user.role = updates.role;
    if (updates.status) user.status = updates.status;
    await user.save();
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    };
  },

  async remove(id: string, actingUserId: string) {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest("Invalid user id");
    if (id === actingUserId) throw ApiError.badRequest("You cannot delete your own account");
    const user = await User.findById(id);
    if (!user) throw ApiError.notFound("User not found");
    if (user.role === "super_admin") {
      throw ApiError.forbidden("Super admin accounts can only be changed directly in the database");
    }
    // Same scope boundary as update() — see the comment there.
    if (!GODOWN_ROLES.includes(user.role as (typeof GODOWN_ROLES)[number])) {
      throw ApiError.forbidden("This account is managed outside this panel");
    }
    user.status = "suspended";
    await user.save();
    return { id: user._id.toString(), status: user.status };
  },
};
