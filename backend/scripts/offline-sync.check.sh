#!/usr/bin/env bash
#
# End-to-end check for the offline flush. Simulates what a phone does when it comes back
# into signal: sends each queued write to the normal endpoint, loses the response, and
# sends the identical request again. Nothing may happen twice.
#
#   1. terminal A:  MONGODB_DB_NAME=Data_synctest npm run seed
#   2. terminal A:  MONGODB_DB_NAME=Data_synctest npm run dev
#   3. terminal B:  ./scripts/offline-sync.check.sh
#
# MONGODB_DB_NAME is the isolation: same cluster, throwaway database. Never point this at
# the database the warehouse is using — it writes rolls and moves stock.
set -euo pipefail

BASE="${BASE:-http://localhost:4000/api}"
EMAIL="${SEED_ADMIN_EMAIL:-admin@docflow.app}"
PASSWORD="${SEED_ADMIN_PASSWORD:-admin@123}"
RUN="$RANDOM"

pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; echo "       expected: $2"; echo "       actual:   $3"; exit 1; }
same() { [ "$2" = "$3" ] && pass "$1" || fail "$1" "$2" "$3"; }

# POST that keeps the status code, so a 409 can be asserted rather than crashing curl.
post() {
  curl -s -o /tmp/oscheck.body -w "%{http_code}" -X POST "$BASE$1" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$2"
}
body() { cat /tmp/oscheck.body; }

echo "offline sync check -> $BASE"

TOKEN=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r '.accessToken // empty')
[ -n "$TOKEN" ] || { echo "login failed — is the server up and seeded?"; exit 1; }

# --- fixtures: the reference rows a phone would have cached before going offline -------
post "/raw-materials" "{\"material_code\":\"SYNC-$RUN\",\"name\":\"Sync Test Paper\",\"unit\":\"KG\"}" >/dev/null
MATERIAL=$(body | jq -r '.id')
post "/vendors" "{\"vendor_code\":\"SV-$RUN\",\"name\":\"Sync Test Vendor\"}" >/dev/null
VENDOR=$(body | jq -r '.id')

ROLL_CID=$(cat /proc/sys/kernel/random/uuid)
ROLL_BODY=$(jq -nc --arg m "$MATERIAL" --arg v "$VENDOR" --arg c "$ROLL_CID" --arg n "SYNC-$RUN" '{
  roll_number:$n, royal_touche_code:"639", material_id:$m, vendor_id:$v,
  weight:45, gsm:80, width:1000,
  location:"Test Bay", date:"2026-08-27", client_id:$c }')

# --- 1. the create the phone never saw a response for ----------------------------------
CHECKPOINT=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
sleep 1
CODE=$(post "/material-rolls" "$ROLL_BODY"); FIRST=$(body | jq -r '.id')
same "create roll accepted" "201" "$CODE"

CODE=$(post "/material-rolls" "$ROLL_BODY"); SECOND=$(body | jq -r '.id')
same "replayed create returns the same roll" "$FIRST" "$SECOND"

COUNT=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/material-rolls?q=SYNC-$RUN" | jq '.total')
same "replay wrote no second roll" "1" "$COUNT"

# --- 2. a genuine duplicate must still be refused --------------------------------------
# Same roll number, different queued item. If isReplayCollision were matching on the wrong
# key this would hand the caller someone else's roll instead of a 409.
OTHER=$(echo "$ROLL_BODY" | jq -c --arg c "$(cat /proc/sys/kernel/random/uuid)" '.client_id=$c')
CODE=$(post "/material-rolls" "$OTHER")
same "duplicate roll_number is still a 409" "409" "$CODE"

# --- 2b. two rolls of the same paper --------------------------------------------------
# royal_touche_code names the base paper, not the roll, so every roll cut from paper 639
# carries 639. This fails the moment the old unique index is still on the collection.
SECOND_ROLL=$(echo "$ROLL_BODY" | jq -c \
  --arg c "$(cat /proc/sys/kernel/random/uuid)" --arg n "SYNC-$RUN-B" \
  '.client_id=$c | .roll_number=$n')
CODE=$(post "/material-rolls" "$SECOND_ROLL")
same "a second roll of the same paper is accepted" "201" "$CODE"
same "and carries the same Royal Touche code" "639" "$(body | jq -r '.royal_touche_code')"

# --- 3. the movement the phone never saw a response for --------------------------------
# An IN adds to remaining_weight. Applied twice, the roll silently gains 10kg that never
# existed — the failure mode nobody notices, which is the whole reason for client_id.
MOVE_CID=$(cat /proc/sys/kernel/random/uuid)
MOVE_BODY=$(jq -nc --arg m "$MATERIAL" --arg r "$FIRST" --arg c "$MOVE_CID" '{
  transaction_type:"IN", material_id:$m, roll_id:$r, weight:10, client_id:$c }')

CODE=$(post "/stock/movements" "$MOVE_BODY"); MFIRST=$(body | jq -r '.id')
same "movement accepted" "201" "$CODE"
AFTER=$(body | jq -r '.roll_weight_after')

CODE=$(post "/stock/movements" "$MOVE_BODY"); MSECOND=$(body | jq -r '.id')
same "replayed movement returns the same row" "$MFIRST" "$MSECOND"

WEIGHT=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/material-rolls/$FIRST" | jq -r '.remaining_weight')
same "replay did not move stock twice" "$AFTER" "$WEIGHT"
same "stock moved exactly once" "55" "$WEIGHT"

# --- 4. delta pull ---------------------------------------------------------------------
# What a device asks for on reconnect: everything touched since its last checkpoint.
DELTA=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/material-rolls?updated_after=$CHECKPOINT&pageSize=200" | jq "[.items[] | select(.id==\"$FIRST\")] | length")
same "delta pull returns the roll changed since the checkpoint" "1" "$DELTA"

FUTURE=$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%S.000Z)
EMPTY=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/material-rolls?updated_after=$FUTURE" | jq '.total')
same "a checkpoint ahead of every row returns nothing" "0" "$EMPTY"

MDELTA=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/stock/movements?updated_after=$CHECKPOINT&pageSize=200" | jq "[.items[] | select(.id==\"$MFIRST\")] | length")
same "movement delta pull returns the new movement" "1" "$MDELTA"

CURSOR=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/stock/movements?updated_after=$CHECKPOINT&pageSize=200" | jq -r '.items[-1].updatedAt // "null"')
[ "$CURSOR" != "null" ] && pass "movements carry updatedAt to checkpoint on" \
  || fail "movements carry updatedAt to checkpoint on" "an ISO date" "null"

# --- 5. batch flush --------------------------------------------------------------------
# A whole outbox in one request: a roll, then a movement against that same roll, which has
# no server id yet and points at it by client_id.
BR_CID=$(cat /proc/sys/kernel/random/uuid)
BM_CID=$(cat /proc/sys/kernel/random/uuid)
BATCH=$(jq -nc --arg m "$MATERIAL" --arg v "$VENDOR" --arg rc "$BR_CID" --arg mc "$BM_CID" --arg n "BATCH-$RUN" '{
  items: [
    { type:"roll", client_id:$rc, body:{
        roll_number:$n, royal_touche_code:"640", material_id:$m, vendor_id:$v,
        weight:60, gsm:90, width:1200,
        location:"Test Bay", date:"2026-08-27" } },
    { type:"movement", client_id:$mc, roll_client_id:$rc, body:{
        transaction_type:"OUT", material_id:$m, location:"Machine 3" } }
  ] }')

CODE=$(post "/sync/batch" "$BATCH")
same "batch accepted" "200" "$CODE"
same "both items applied" "2" "$(body | jq '.applied')"
same "nothing to resume from" "null" "$(body | jq '.resume_from')"
BATCH_ROLL=$(body | jq -r '.results[0].data.id')

# The movement resolved roll_client_id to the roll created one item earlier — the reason a
# batch can hold "register then issue" at all.
same "movement bound to the roll from the same batch" "$BATCH_ROLL" "$(body | jq -r '.results[1].data.roll_id.id')"

# The whole batch re-sent, exactly as a device would after a lost response.
CODE=$(post "/sync/batch" "$BATCH")
same "replayed batch still returns 200" "200" "$CODE"
same "replayed batch applied both as replays" "2" "$(body | jq '.applied')"
same "replayed batch returns the same roll" "$BATCH_ROLL" "$(body | jq -r '.results[0].data.id')"
COUNT=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/material-rolls?q=BATCH-$RUN" | jq '.total')
same "replayed batch wrote no second roll" "1" "$COUNT"

# --- 6. partial failure ----------------------------------------------------------------
# Item 2 reuses a roll_number that already exists. Item 1 must stay written, item 2 must
# report the 409, and item 3 must not be attempted at all.
PARTIAL=$(jq -nc --arg m "$MATERIAL" --arg v "$VENDOR" --arg dup "BATCH-$RUN" --arg run "$RUN" \
  --arg a "$(cat /proc/sys/kernel/random/uuid)" \
  --arg b "$(cat /proc/sys/kernel/random/uuid)" \
  --arg c "$(cat /proc/sys/kernel/random/uuid)" '
  def roll($n): { roll_number:$n, royal_touche_code:"639", material_id:$m, vendor_id:$v,
                  weight:20, gsm:70, width:900, location:"Test Bay", date:"2026-08-27" };
  { items: [
      { type:"roll", client_id:$a, body: roll("P1-\($run)") },
      { type:"roll", client_id:$b, body: roll($dup) },
      { type:"roll", client_id:$c, body: roll("P3-\($run)") }
  ] }')

CODE=$(post "/sync/batch" "$PARTIAL")
same "partial batch is still a 200, not a failure" "200" "$CODE"
same "one item applied"  "1" "$(body | jq '.applied')"
same "one item failed"   "1" "$(body | jq '.failed')"
same "one item skipped"  "1" "$(body | jq '.skipped')"
same "failure reported as a 409" "409" "$(body | jq '.results[1].code')"
same "resume index points at the failure" "1" "$(body | jq '.resume_from')"
same "the item behind the failure was not attempted" "skipped" "$(body | jq -r '.results[2].status')"

# The item before the failure really is on the server — that is what makes resume_from safe.
same "the applied item survived the partial batch" "1" \
  "$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/material-rolls?q=P1-$RUN" | jq '.total')"
same "the skipped item was never created" "0" \
  "$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/material-rolls?q=P3-$RUN" | jq '.total')"

echo "offline sync check: all assertions passed"
