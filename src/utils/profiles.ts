import {Bond} from '../types';

/**
 * Browser-only named profiles for the Savings Bond Wizard app.
 *
 * Each profile keeps its own `bonds` and `selected` array in localStorage,
 * namespaced by the profile name. The list of profiles and the currently
 * active profile are also stored. Tax rate and dark-mode preferences are
 * intentionally left as global preferences (not per-profile), since they
 * are device-level UI settings, not portfolio data.
 *
 * This module also does a one-time migration of the pre-profile data
 * (legacy keys: `bonds_wizard_portfolio`, `bonds_wizard_selected`) into
 * a fresh `Default` profile, so any user upgrading from the previous
 * build keeps their existing portfolio.
 */

const STORAGE = {
  ACTIVE_PROFILE: 'sbw.active_profile',
  PROFILES: 'sbw.profiles',
  BONDS: (name: string) => `sbw.bonds.${safeKey(name)}`,
  SELECTED: (name: string) => `sbw.selected.${safeKey(name)}`,
  // Pre-profile data keys (used only by the one-time migration).
  LEGACY_BONDS: 'bonds_wizard_portfolio',
  LEGACY_SELECTED: 'bonds_wizard_selected',
  LEGACY_TAX_RATE: 'bonds_wizard_tax_rate',
  LEGACY_DARK_MODE: 'bonds_wizard_dark_mode',
};

function safeKey(name: string): string {
  // Sanitize for use as part of a localStorage key. Replaces anything
  // that's not a letter, digit, dash, underscore, or dot with '_'.
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export interface ProfileMeta {
  name: string;
  createdAt: string;
}

export interface ProfileData {
  bonds: Bond[];
  selected: string[];
}

// ---------- Low-level read/write of profile metadata ----------

export function listProfiles(): ProfileMeta[] {
  try {
    const raw = localStorage.getItem(STORAGE.PROFILES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProfiles(profiles: ProfileMeta[]): void {
  localStorage.setItem(STORAGE.PROFILES, JSON.stringify(profiles));
}

export function getActiveProfileName(): string | null {
  return localStorage.getItem(STORAGE.ACTIVE_PROFILE);
}

export function setActiveProfileName(name: string): void {
  localStorage.setItem(STORAGE.ACTIVE_PROFILE, name);
}

// ---------- Per-profile portfolio data ----------

export function loadProfileData(name: string): ProfileData {
  const out: ProfileData = {bonds: [], selected: []};
  try {
    const bondsRaw = localStorage.getItem(STORAGE.BONDS(name));
    if (bondsRaw) {
      const parsed = JSON.parse(bondsRaw);
      if (Array.isArray(parsed)) out.bonds = parsed;
    }
  } catch {
    // ignore; default to empty
  }
  try {
    const selectedRaw = localStorage.getItem(STORAGE.SELECTED(name));
    if (selectedRaw) {
      const parsed = JSON.parse(selectedRaw);
      if (Array.isArray(parsed)) out.selected = parsed;
    }
  } catch {
    // ignore; default to empty
  }
  return out;
}

export function saveProfileData(name: string, data: Partial<ProfileData>): void {
  if (data.bonds !== undefined) {
    localStorage.setItem(STORAGE.BONDS(name), JSON.stringify(data.bonds));
  }
  if (data.selected !== undefined) {
    localStorage.setItem(STORAGE.SELECTED(name), JSON.stringify(data.selected));
  }
}

export function deleteProfileData(name: string): void {
  localStorage.removeItem(STORAGE.BONDS(name));
  localStorage.removeItem(STORAGE.SELECTED(name));
}

// ---------- High-level operations ----------

/**
 * Make sure at least one profile exists and `ACTIVE_PROFILE` points to
 * a real one. Should be called once at app boot (in a lazy state init)
 * before reading any profile data.
 */
export function ensureProfilesInitialized(
  defaultName: string,
  defaultBonds: Bond[],
): void {
  const existing = listProfiles();
  if (existing.length === 0) {
    const fallback: ProfileMeta = {
      name: defaultName,
      createdAt: new Date().toISOString(),
    };
    saveProfiles([fallback]);
    saveProfileData(defaultName, {bonds: defaultBonds, selected: []});
  }
  const active = getActiveProfileName();
  if (!active || !existing.some(p => p.name === active)) {
    // No active set, OR active points at a profile that was deleted.
    const profiles = listProfiles();
    setActiveProfileName(profiles[0]?.name ?? defaultName);
  }
}

/**
 * One-time migration from the legacy single-portfolio localStorage
 * layout to the profile-aware layout. If legacy keys are present AND
 * no profile yet exists, import the legacy data into the Default
 * profile, then clear the legacy keys to avoid double-storage.
 */
export function migrateLegacyData(defaultProfileName: string): boolean {
  const profileList = listProfiles();
  if (profileList.length > 0) {
    // Already a profile-aware user — nothing to migrate.
    return false;
  }
  const legacyBondsRaw = localStorage.getItem(STORAGE.LEGACY_BONDS);
  const legacySelectedRaw = localStorage.getItem(STORAGE.LEGACY_SELECTED);
  if (!legacyBondsRaw && !legacySelectedRaw) {
    return false;
  }

  let legacyBonds: Bond[] = [];
  let legacySelected: string[] = [];
  try {
    if (legacyBondsRaw) {
      const parsed = JSON.parse(legacyBondsRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        legacyBonds = parsed;
      }
    }
  } catch {
    // ignore parse failures and fall back to []
  }
  try {
    if (legacySelectedRaw) {
      const parsed = JSON.parse(legacySelectedRaw);
      if (Array.isArray(parsed)) {
        legacySelected = parsed;
      }
    }
  } catch {
    // ignore
  }

  const fallback: ProfileMeta = {
    name: defaultProfileName,
    createdAt: new Date().toISOString(),
  };
  saveProfiles([fallback]);
  setActiveProfileName(defaultProfileName);
  saveProfileData(defaultProfileName, {
    bonds: legacyBonds,
    selected: legacySelected,
  });

  // Clean up the legacy keys to free storage.
  localStorage.removeItem(STORAGE.LEGACY_BONDS);
  localStorage.removeItem(STORAGE.LEGACY_SELECTED);
  return true;
}

/**
 * Move a profile's portfolio data to a new name (also updates the
 * profile list and the active marker).
 */
export function renameProfile(oldName: string, newName: string): void {
  if (oldName === newName) return;
  const trimmed = newName.trim();
  if (!trimmed) return;

  const data = loadProfileData(oldName);
  saveProfileData(trimmed, data);
  deleteProfileData(oldName);

  const updated = listProfiles().map(p =>
    p.name === oldName ? {...p, name: trimmed} : p,
  );
  saveProfiles(updated);
  if (getActiveProfileName() === oldName) {
    setActiveProfileName(trimmed);
  }
}

export function profileNameExists(name: string): boolean {
  return listProfiles().some(p => p.name === name);
}
