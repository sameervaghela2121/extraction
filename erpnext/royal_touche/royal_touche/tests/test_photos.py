import frappe
from frappe.tests import IntegrationTestCase

from frappe.core.doctype.file.file import has_permission as file_has_permission

from royal_touche.errors import RTValidation
from royal_touche.lots import create_lot
from royal_touche.photos import check, is_file_path
from royal_touche.rolls import register_roll
from royal_touche.tests.factories import as_user, base_roll, make_file, make_material, make_user, standard_locations
from royal_touche.tests.test_movements import move


class TestPhotoPaths(IntegrationTestCase):
    """The shape check alone, so a bad value is refused by rule, not only because no File has
    that path."""

    def test_plain_file_names_only(self):
        for good in ("/private/files/scale-proof-085ec51.jpg", "/files/my photo (1)_a.jpg"):
            self.assertTrue(is_file_path(good), good)
        for bad in ("/files/%2e%2e\\api\\method\\x", "/files/%2e%2e", "/files/a%2fb.jpg", "/files/a\\b.jpg", "/files/a\tb.jpg",
                    "/files/a.jpg\n", "/files/.hidden", "/private/files/notes.txt", "/private/files/invoice.pdf", "/private/files/noextension", "/files/../x.jpg", "/files/a..b.jpg", "/api/method/x", "files/a.jpg",
                    "https://evil.example/x.jpg", "/private/files/", None, 5):
            self.assertFalse(is_file_path(bad), repr(bad))


class TestEveryRoleSeesEveryPhoto(IntegrationTestCase):
    """A private file is readable by its uploader, or by whoever can read what it's attached to.
    So photos are attached to their record: otherwise only the person who took one could open it."""

    def setUp(self):
        self.loc = standard_locations()
        self.operator, self.supervisor = make_user("Godown Operator"), make_user("Godown Supervisor")
        self.admin = make_user("RT Admin")

    def uploaded_by(self, user):
        with as_user(user):
            return make_file()

    def assert_everyone_can_open(self, path, doctype, name):
        rows = frappe.get_all("File", {"file_url": path}, ["attached_to_doctype", "attached_to_name"])
        self.assertTrue(rows and all((r.attached_to_doctype, r.attached_to_name) == (doctype, name) for r in rows), path)
        doc = frappe.get_doc("File", {"file_url": path})
        for user in (self.operator, self.supervisor, self.admin):
            with as_user(user):
                self.assertTrue(file_has_permission(doc, "read", user), user)

    def test_movement_photo(self):
        path = self.uploaded_by(self.operator)
        roll = register_roll(base_roll(location=self.loc["GODOWN-A-1"]))["name"]
        res = move(roll, "OUT", location=self.loc["RUNNING-1"], photos=[path])
        self.assert_everyone_can_open(path, "Roll Movement", res["movement"]["name"])

    def test_roll_photo_uploaded_by_someone_else(self):
        path = self.uploaded_by(self.supervisor)
        with as_user(self.operator):
            roll = register_roll(base_roll(side1_photo=path))["name"]
        self.assert_everyone_can_open(path, "Batch", roll)

    def test_lot_photo(self):
        path = self.uploaded_by(self.operator)
        lot = create_lot({"document_type": "challan", "document_no": "PH-1", "document_photo": path})
        self.assert_everyone_can_open(path, "Roll Lot", lot["name"])

    def test_a_file_belonging_to_something_else_is_refused(self):
        path = self.uploaded_by(self.operator)
        frappe.db.set_value("File", {"file_url": path}, {"attached_to_doctype": "Item", "attached_to_name": make_material()})
        with self.assertRaisesRegex(RTValidation, "Photos must be files uploaded to this server"):
            register_roll(base_roll(side1_photo=path))
        self.assertEqual(frappe.db.get_value("File", {"file_url": path}, "attached_to_doctype"), "Item")

    def test_a_file_from_outside_the_app_is_refused(self):
        path = self.uploaded_by(make_user("Accounts User"))
        with self.assertRaisesRegex(RTValidation, "Photos must be files uploaded to this server"):
            register_roll(base_roll(side1_photo=path))
        self.assertFalse(frappe.db.get_value("File", {"file_url": path}, "attached_to_doctype"))

    def test_an_administrators_file_is_refused_for_anyone_else(self):
        manager = make_user("System Manager")
        for owner in (manager, "Administrator"):
            path = self.uploaded_by(owner)
            with as_user(self.operator), self.assertRaisesRegex(RTValidation, "Photos must be files uploaded to this server"):
                register_roll(base_roll(side1_photo=path))
            self.assertFalse(frappe.db.get_value("File", {"file_url": path}, "attached_to_doctype"))

    def test_people_can_use_their_own_upload_whatever_their_role(self):
        manager = make_user("System Manager")
        path = self.uploaded_by(manager)
        data = base_roll(side1_photo=path)
        with as_user(manager):
            self.assertEqual(register_roll(data)["side1_photo"], path)

    def test_a_non_image_is_refused(self):
        path = frappe.get_doc({"doctype": "File", "file_name": frappe.generate_hash(length=8) + ".txt", "is_private": 1,
                               "content": frappe.generate_hash().encode()}).insert(ignore_permissions=True).file_url
        with self.assertRaisesRegex(RTValidation, "Photos must be files uploaded to this server"):
            register_roll(base_roll(side1_photo=path))


class TestPortalUploadNames(IntegrationTestCase):
    """The portal uploads every photo under a generated name (frontend/src/api/client.ts
    uploadName: a UUID, or 32 hex digits where randomUUID isn't available, plus the photo's
    extension), because people's own file names often fail the plain-name rule."""

    def test_generated_names_pass_the_check_for_their_uploader(self):
        import uuid

        operator = make_user("Godown Operator")
        names = [f"{uuid.uuid4()}.{ext}" for ext in ("jpg", "jpeg", "png", "webp")] + [f"{uuid.uuid4().hex}.jpg"]
        for name in names:
            with as_user(operator):
                path = make_file(name)
                self.assertEqual(path, f"/private/files/{name}")
                check([path])

    def test_names_people_give_their_files_would_not(self):
        for name in ("challan #12.jpg", "_x.jpg", "फोटो.jpg"):
            self.assertFalse(is_file_path(f"/private/files/{name}"), name)
