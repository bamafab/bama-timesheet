// ─────────────────────────────────────────────────────────────────────────────
// changelog.js — who-did-what audit trail (Fault Register F6 / Phase B3)
//
// One helper, wired into state-changing endpoints. NON-FATAL by design: an
// audit write must never break the business operation it describes, so every
// failure is swallowed (logged to context/console only).
//
// Table: ChangeLog (see api/sql/create-changelog.sql). New table => no
// Function App restart needed.
// ─────────────────────────────────────────────────────────────────────────────

const { query } = require('./db');

/**
 * Record a state change. Fire-and-forget safe (returns a promise; callers may
 * await or not). All values are truncated defensively to fit the columns.
 *
 * @param {string} entityType  e.g. 'qb_quote' | 'application' | 'invoice'
 * @param {number} entityId    SQL id of the row
 * @param {string} entityRef   human ref (Q260712, AFP05, INV-0031…)
 * @param {string} action      e.g. 'status_change' | 'hard_delete' | 'certified'
 * @param {*}      oldValue    previous state (stringified)
 * @param {*}      newValue    new state (stringified)
 * @param {string} changedBy   auth.name || auth.email
 */
async function logChange(entityType, entityId, entityRef, action, oldValue, newValue, changedBy) {
    try {
        const s = (v, n) => v == null ? null : String(v).slice(0, n);
        await query(
            `INSERT INTO ChangeLog
                (entity_type, entity_id, entity_ref, action, old_value, new_value, changed_by, changed_at)
             VALUES (@entity_type, @entity_id, @entity_ref, @action, @old_value, @new_value, @changed_by, GETUTCDATE())`,
            {
                entity_type: s(entityType, 40),
                entity_id:   parseInt(entityId) || null,
                entity_ref:  s(entityRef, 60),
                action:      s(action, 60),
                old_value:   s(oldValue, 400),
                new_value:   s(newValue, 400),
                changed_by:  s(changedBy, 120) || 'unknown'
            }
        );
    } catch (e) {
        // Table may not exist yet (migration pending) or transient failure —
        // the business operation must proceed regardless.
        console.warn('logChange failed (non-fatal):', e.message);
    }
}

module.exports = { logChange };
