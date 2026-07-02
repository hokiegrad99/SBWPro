import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  TrendingUp,
  Wallet,
  Coins,
  Download,
  Upload,
  Plus,
  Trash2,
  Search,
  Moon,
  Sun,
  RefreshCw,
  FileSpreadsheet,
  FileCode,
  AlertTriangle,
  X,
  Info,
  ChevronUp,
  ChevronDown,
  CheckSquare,
  Square,
  Edit2,
  Check,
  HelpCircle,
  Clock,
  BookOpen,
  ArrowRightLeft,
  Users,
  Sparkles,
} from 'lucide-react';
import { Bond, SortField, SortDirection } from './types';
import { SAMPLE_BONDS } from './data/sampleBonds';
import {
  parseBondsFromHTML,
  generateTreasuryHTML,
  parseBondsFromCSV,
  generateCSV,
  isBondMatured
} from './utils/bondParser';
import {
  ensureProfilesInitialized,
  migrateLegacyData,
  listProfiles,
  saveProfiles,
  loadProfileData,
  saveProfileData,
  deleteProfileData,
  getActiveProfileName,
  setActiveProfileName,
  profileNameExists,
  ProfileMeta,
} from './utils/profiles';
import {
  TREASURY_CALCULATOR_URL,
  TREASURY_CALCULATOR_HELP_URL,
} from './utils/treasuryLinks';

const DEFAULT_PROFILE_NAME = 'Default';

export default function App() {
  // --- Core State ---
  // Run the one-time legacy-data migration + profile system
  // initialization before any profile data is read. Both are idempotent.
  const [currentProfile, setCurrentProfile] = useState<string>(() => {
    migrateLegacyData(DEFAULT_PROFILE_NAME);
    ensureProfilesInitialized(DEFAULT_PROFILE_NAME);
    return getActiveProfileName() ?? DEFAULT_PROFILE_NAME;
  });

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');

  // First-run onboarding: shows a small banner + pulse highlight over the
  // import drop zone until the user has imported any bond, loaded the
  // sample, added a bond manually, or explicitly clicked "Got it".
  // Persisted in localStorage so the tip is truly one-time-per-device.
  const [firstRunTooltipDismissed, setFirstRunTooltipDismissed] = useState<boolean>(
    () => localStorage.getItem('sbw.first_run_tooltip_dismissed') === 'true',
  );
  const dismissFirstRunTooltip = () => {
    localStorage.setItem('sbw.first_run_tooltip_dismissed', 'true');
    setFirstRunTooltipDismissed(true);
  };
  // Snapshot the dismissal flag as of the first render. The auto-dismiss
  // effect below uses this to skip the redundant localStorage write for
  // returning users whose tooltip was already dismissed on a previous
  // visit. (React refs survive the mount lifetime but don't reset on
  // re-render, so the value is fixed for the whole session.)
  const mountedAlreadyDismissedRef = useRef(firstRunTooltipDismissed);

  // Profile-onboarding: same one-time-per-device pattern as the
  // import-dropzone tooltip — points at the profile button in the
  // header until the user opens the manager modal for the first time.
  const [profileTooltipDismissed, setProfileTooltipDismissed] = useState<boolean>(
    () => localStorage.getItem('sbw.profile_tooltip_dismissed') === 'true',
  );
  const dismissProfileTooltip = () => {
    // Idempotent: bail out for returning users (or in-session re-opens)
    // whose flag is already set, so we don't redundantly rewrite
    // localStorage on every modal open.
    if (localStorage.getItem('sbw.profile_tooltip_dismissed') === 'true') return;
    localStorage.setItem('sbw.profile_tooltip_dismissed', 'true');
    setProfileTooltipDismissed(true);
  };
  const mountedAlreadyProfileDismissedRef = useRef(profileTooltipDismissed);

  const [bonds, setBonds] = useState<Bond[]>(() => {
    const profile = getActiveProfileName() ?? DEFAULT_PROFILE_NAME;
    // First-time visitors read an EMPTY portfolio here — the welcome
    // card below in the table takes over and offers three explicit
    // ways to populate the inventory (import / add / load sample).
    return loadProfileData(profile).bonds;
  });

  const [selectedSerials, setSelectedSerials] = useState<string[]>(() => {
    const profile = getActiveProfileName() ?? DEFAULT_PROFILE_NAME;
    return loadProfileData(profile).selected;
  });

  // When the active profile changes, swap the in-memory state over to
  // that profile's stored portfolio. Runs after switchProfile/handlers
  // have already written the previous profile's data.
  useEffect(() => {
    if (!currentProfile) return;
    const data = loadProfileData(currentProfile);
    setBonds(data.bonds.length > 0 ? data.bonds : []);
    setSelectedSerials(data.selected);
    // Intentionally no deps on bonds/selectedSerials — we want this to
    // fire only when the *profile* changes, not every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProfile]);

  // Auto-dismiss the first-run onboarding tip the moment the portfolio
  // has any bonds in it — covers import, manual add, load sample, and
  // switching into a profile that already had data. Idempotent.
  useEffect(() => {
    // Skip the redundant localStorage.setItem("true") for returning
    // users who already dismissed the tip on a previous visit.
    if (mountedAlreadyDismissedRef.current) return;
    if (bonds.length > 0) {
      dismissFirstRunTooltip();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bonds]);

  // Auto-dismiss the profile-onboarding tip the moment the user opens
  // the profile manager modal for the first time.
  useEffect(() => {
    // Skip the redundant localStorage.setItem("true") for returning
    // users who already dismissed the tip on a previous visit.
    if (mountedAlreadyProfileDismissedRef.current) return;
    if (profileModalOpen) {
      dismissProfileTooltip();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileModalOpen]);

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('bonds_wizard_dark_mode');
    if (saved) return saved === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [marginalTaxRate, setMarginalTaxRate] = useState<number>(() => {
    const saved = localStorage.getItem('bonds_wizard_tax_rate');
    return saved ? parseInt(saved, 10) : 22; // default to 22% bracket
  });

  const [excludeEducation, setExcludeEducation] = useState<boolean>(false);

  // --- Filtering & Sorting State ---
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterSeries, setFilterSeries] = useState<'All' | 'I' | 'EE'>('All');
  const [filterStatus, setFilterStatus] = useState<'All' | 'Active' | 'Matured'>('All');
  const [filterCashOut, setFilterCashOut] = useState<'All' | 'Marked' | 'Kept'>('All');
  const [sortBy, setSortBy] = useState<SortField>('value');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // --- Manual Form State ---
  const [isAddingBond, setIsAddingBond] = useState(false);
  const [formSerial, setFormSerial] = useState('');
  const [formSeries, setFormSeries] = useState<'I' | 'EE'>('I');
  const [formDenomination, setFormDenomination] = useState<number>(100);
  const [formIssueDate, setFormIssueDate] = useState('07/2010'); // Default to a standard date
  const [formInterestRate, setFormInterestRate] = useState<number>(3.5);
  const [formCurrentValue, setFormCurrentValue] = useState<number>(125);
  const [formNote, setFormNote] = useState('');
  const [formError, setFormError] = useState('');

  // --- Note Editing State ---
  const [editingSerial, setEditingSerial] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState('');

  // --- File Drag & Drop ---
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // --- Persistence Sync ---
  // Portfolio data is namespaced under the active profile. We deliberately
  // depend ONLY on `bonds` / `selectedSerials` (not on `currentProfile`):
  // the profile-switching effect above replaces these values atomically, and
  // skipping persistence on the profile-change render avoids clobbering the
  // newly-loaded data with the previous profile's data.
  useEffect(() => {
    if (currentProfile) {
      saveProfileData(currentProfile, { bonds });
    }
  }, [bonds]);

  useEffect(() => {
    if (currentProfile) {
      saveProfileData(currentProfile, { selected: selectedSerials });
    }
  }, [selectedSerials]);

  useEffect(() => {
    localStorage.setItem('bonds_wizard_tax_rate', marginalTaxRate.toString());
  }, [marginalTaxRate]);

  useEffect(() => {
    localStorage.setItem('bonds_wizard_dark_mode', isDarkMode.toString());
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // --- Notification Helper ---
  const showNotification = (type: 'success' | 'error' | 'info', text: string) => {
    setNotification({ type, text });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  // --- Date Parsing and Maturity Calculation Helpers ---
  const parseDateToMonths = (dateStr: string): number => {
    if (!dateStr) return 0;
    const parts = dateStr.split('/');
    if (parts.length !== 2) return 0;
    const month = parseInt(parts[0], 10);
    const year = parseInt(parts[1], 10);
    if (isNaN(month) || isNaN(year)) return 0;
    return year * 12 + (month - 1);
  };

  // Automatically compute Final Maturity (30 years after issue date)
  const computeFinalMaturity = (issueDateStr: string): string => {
    if (!issueDateStr) return '';
    const parts = issueDateStr.split('/');
    if (parts.length !== 2) return '';
    const month = parts[0];
    const year = parseInt(parts[1], 10);
    if (isNaN(year)) return '';
    return `${month}/${year + 30}`;
  };

  // --- Auto-fill Issue Price & Estimations on Form Input ---
  const computedIssuePrice = useMemo(() => {
    if (formSeries === 'I') return formDenomination;
    return formDenomination * 0.5; // EE is half of face value
  }, [formSeries, formDenomination]);

  useEffect(() => {
    // Proactive approximation of current value based on issue date
    // Simple logic: add a baseline interest for UI friendliness
    const months = parseDateToMonths(formIssueDate);
    const currentMonths = parseDateToMonths("07/2026");
    const ageInYears = Math.max(0, (currentMonths - months) / 12);
    
    // Estimate simple accrued interest at formInterestRate
    const estimatedValue = computedIssuePrice + (computedIssuePrice * (formInterestRate / 100) * ageInYears);
    setFormCurrentValue(Math.round(estimatedValue * 100) / 100);
  }, [formIssueDate, formInterestRate, computedIssuePrice]);

  // --- Portfolio Calculations ---
  const stats = useMemo(() => {
    let totalFace = 0;
    let totalCost = 0;
    let totalVal = 0;
    let totalInt = 0;
    let maturedCount = 0;

    bonds.forEach(b => {
      totalFace += b.denomination;
      totalCost += b.issuePrice;
      totalVal += b.value;
      totalInt += b.interest;
      if (isBondMatured(b.finalMaturity, 2026, 7)) {
        maturedCount++;
      }
    });

    const averageRate = bonds.length > 0 
      ? bonds.reduce((sum, b) => sum + b.interestRate, 0) / bonds.length 
      : 0;

    return {
      count: bonds.length,
      faceValue: totalFace,
      price: totalCost,
      currentValue: totalVal,
      interest: totalInt,
      maturedCount,
      averageRate
    };
  }, [bonds]);

  // --- Tax Estimator Calculations ---
  const taxStats = useMemo(() => {
    let cashoutCount = 0;
    let cashoutFace = 0;
    let cashoutValue = 0;
    let cashoutInterest = 0;

    bonds.forEach(b => {
      if (selectedSerials.includes(b.serial)) {
        cashoutCount++;
        cashoutFace += b.denomination;
        cashoutValue += b.value;
        cashoutInterest += b.interest; // Interest is subject to federal income tax
      }
    });

    const taxDue = excludeEducation ? 0 : cashoutInterest * (marginalTaxRate / 100);
    const netProceeds = cashoutValue - taxDue;

    return {
      cashoutCount,
      cashoutFace,
      cashoutValue,
      cashoutInterest,
      taxDue,
      netProceeds
    };
  }, [bonds, selectedSerials, marginalTaxRate, excludeEducation]);

  // --- Reset/Clear Handlers ---
  const handleLoadSample = () => {
    if (window.confirm("Replace current portfolio with the original US Treasury sample portfolio?")) {
      setBonds(SAMPLE_BONDS);
      setSelectedSerials([]);
      showNotification('success', 'Loaded 53 sample bonds matching the US Treasury calculator!');
    }
  };

  const handleClearAll = () => {
    if (window.confirm(`Are you sure you want to delete all bonds from this profile ("${currentProfile}")?`)) {
      setBonds([]);
      setSelectedSerials([]);
      showNotification('info', `Profile "${currentProfile}" cleared. Use manual entry or upload a file to begin.`);
    }
  };

  // --- Profile Management Handlers ---
  const handleSwitchProfile = (name: string) => {
    if (name === currentProfile) return;
    // Flush any in-memory edits to the *current* profile before swapping.
    saveProfileData(currentProfile, { bonds, selected: selectedSerials });
    setActiveProfileName(name);
    setCurrentProfile(name);
  };

  const handleCreateProfile = (rawName: string) => {
    const trimmed = rawName.trim();
    if (!trimmed) return;
    if (profileNameExists(trimmed)) {
      showNotification('error', `A profile named "${trimmed}" already exists.`);
      return;
    }
    // Flush current profile's data before switching into the empty new one.
    saveProfileData(currentProfile, { bonds, selected: selectedSerials });
    saveProfiles([
      ...listProfiles(),
      {name: trimmed, createdAt: new Date().toISOString()},
    ]);
    setActiveProfileName(trimmed);
    setCurrentProfile(trimmed);
    setNewProfileName('');
    showNotification('success', `Created and switched to profile "${trimmed}".`);
  };

  const handleRenameProfile = (oldName: string, rawNewName: string) => {
    const trimmed = rawNewName.trim();
    if (!trimmed || trimmed === oldName) return;
    if (profileNameExists(trimmed)) {
      showNotification('error', `A profile named "${trimmed}" already exists.`);
      return;
    }
    // Flush in-memory edits on the active profile before moving its
    // storage around. Mirrors the explicit flush in handleSwitchProfile
    // / handleCreateProfile — without this, a user who toggled a
    // checkbox and immediately renamed the active profile would have
    // that toggle silently overwritten by the stale localStorage value.
    if (currentProfile === oldName) {
      saveProfileData(oldName, { bonds, selected: selectedSerials });
    }
    const data = loadProfileData(oldName);
    saveProfileData(trimmed, data);
    deleteProfileData(oldName);
    saveProfiles(
      listProfiles().map(p => (p.name === oldName ? {...p, name: trimmed} : p)),
    );
    if (currentProfile === oldName) {
      setActiveProfileName(trimmed);
      setCurrentProfile(trimmed);
    }
    showNotification('success', `Renamed profile "${oldName}" to "${trimmed}".`);
  };

  const handleDeleteProfile = (name: string) => {
    const liveProfiles = listProfiles();
    if (liveProfiles.length <= 1) {
      showNotification('error', 'Cannot delete the last remaining profile.');
      return;
    }
    if (!window.confirm(`Delete profile "${name}"? All of its bonds and tax selections will be permanently removed from this device.`)) {
      return;
    }
    deleteProfileData(name);
    const remaining = liveProfiles.filter(p => p.name !== name);
    saveProfiles(remaining);
    if (currentProfile === name) {
      const next = remaining[0].name;
      setActiveProfileName(next);
      setCurrentProfile(next);
    }
    showNotification('info', `Profile "${name}" deleted.`);
  };

  // --- Selection Handlers ---
  const handleToggleSelect = (serial: string) => {
    setSelectedSerials(prev => 
      prev.includes(serial) ? prev.filter(s => s !== serial) : [...prev, serial]
    );
  };

  const handleSelectAllFiltered = (filteredBonds: Bond[]) => {
    const filteredSerials = filteredBonds.map(b => b.serial);
    const allAreSelected = filteredSerials.every(s => selectedSerials.includes(s));
    
    if (allAreSelected) {
      // Unselect all filtered
      setSelectedSerials(prev => prev.filter(s => !filteredSerials.includes(s)));
    } else {
      // Select all filtered
      setSelectedSerials(prev => {
        const union = new Set([...prev, ...filteredSerials]);
        return Array.from(union);
      });
    }
  };

  const handleClearTaxSelection = () => {
    setSelectedSerials([]);
    showNotification('info', 'Unmarked all bonds for cash out.');
  };

  // --- Manual Add Handler ---
  const handleAddManualBond = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const trimmedSerial = formSerial.trim().toUpperCase();
    if (!trimmedSerial) {
      setFormError('Serial number is required.');
      return;
    }

    // Check duplicate
    if (bonds.some(b => b.serial === trimmedSerial)) {
      setFormError('A bond with this serial number already exists.');
      return;
    }

    // Date formatting check (MM/YYYY)
    const dateRegex = /^(0[1-9]|1[0-2])\/\d{4}$/;
    if (!dateRegex.test(formIssueDate.trim())) {
      setFormError('Issue Date must be in MM/YYYY format (e.g. 05/2010).');
      return;
    }

    const calculatedMaturity = computeFinalMaturity(formIssueDate.trim());
    const finalValue = Math.max(computedIssuePrice, formCurrentValue);
    const finalInterest = Math.max(0, finalValue - computedIssuePrice);

    const newBond: Bond = {
      serial: trimmedSerial,
      series: formSeries,
      denomination: formDenomination,
      issueDate: formIssueDate.trim(),
      nextAccrual: "08/2026", // assume default accrual context matching sample
      finalMaturity: calculatedMaturity,
      issuePrice: computedIssuePrice,
      interest: Number(finalInterest.toFixed(2)),
      interestRate: formInterestRate,
      value: Number(finalValue.toFixed(2)),
      note: formNote.trim()
    };

    setBonds(prev => [newBond, ...prev]);
    setIsAddingBond(false);
    
    // Reset form fields
    setFormSerial('');
    setFormNote('');
    showNotification('success', `Added Bond ${trimmedSerial} successfully!`);
  };

  // --- Note Inline Edit ---
  const handleStartEditNote = (serial: string, currentNote: string) => {
    setEditingSerial(serial);
    setEditingNote(currentNote);
  };

  const handleSaveNote = (serial: string) => {
    setBonds(prev => prev.map(b => b.serial === serial ? { ...b, note: editingNote.trim() } : b));
    setEditingSerial(null);
    showNotification('success', 'Updated bond note.');
  };

  const handleDeleteBond = (serial: string) => {
    if (window.confirm(`Are you sure you want to delete bond ${serial}?`)) {
      setBonds(prev => prev.filter(b => b.serial !== serial));
      setSelectedSerials(prev => prev.filter(s => s !== serial));
      showNotification('info', `Bond ${serial} removed.`);
    }
  };

  // --- File Import Parsers ---
  const processImportedFile = (file: File) => {
    const reader = new FileReader();
    const fileName = file.name;
    const fileExtension = fileName.split('.').pop()?.toLowerCase();

    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      let importedBonds: Bond[] = [];

      if (fileExtension === 'html' || fileExtension === 'htm') {
        importedBonds = parseBondsFromHTML(text);
      } else if (fileExtension === 'csv') {
        importedBonds = parseBondsFromCSV(text);
      } else {
        showNotification('error', 'Unsupported file format. Please upload .html or .csv.');
        return;
      }

      if (importedBonds.length === 0) {
        showNotification('error', 'No savings bonds could be found in this file. Please verify the file format.');
        return;
      }

      // Add to portfolio (avoid duplicates by matching serial number)
      setBonds(prev => {
        const existingSerials = new Set(prev.map(b => b.serial));
        const nonDuplicates = importedBonds.filter(b => !existingSerials.has(b.serial));
        const duplicatesCount = importedBonds.length - nonDuplicates.length;
        
        if (duplicatesCount > 0) {
          showNotification('info', `Imported ${nonDuplicates.length} new bonds. Skipped ${duplicatesCount} duplicate serial numbers.`);
        } else {
          showNotification('success', `Successfully imported ${nonDuplicates.length} bonds from "${fileName}"!`);
        }
        
        return [...nonDuplicates, ...prev];
      });
    };

    reader.readAsText(file);
  };

  // --- Drag and Drop Handlers ---
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processImportedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processImportedFile(e.target.files[0]);
    }
  };

  // --- Export Actions ---
  const handleExportHTML = () => {
    if (bonds.length === 0) {
      showNotification('error', 'No bonds in inventory to export.');
      return;
    }
    const htmlContent = generateTreasuryHTML(bonds);
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Savings_Bond_Inventory_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('success', 'Exported HTML file matching US Treasury specifications.');
  };

  const handleExportCSV = () => {
    if (bonds.length === 0) {
      showNotification('error', 'No bonds in inventory to export.');
      return;
    }
    const csvContent = generateCSV(bonds);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Savings_Bond_Portfolio_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('success', 'Exported standard CSV portfolio file.');
  };

  // --- Filtering & Sorting Logic ---
  const sortedAndFilteredBonds = useMemo(() => {
    return bonds
      .filter(b => {
        // Search filter
        const query = searchQuery.toLowerCase().trim();
        const matchesSearch = !query || 
          b.serial.toLowerCase().includes(query) || 
          b.note.toLowerCase().includes(query) ||
          b.issueDate.includes(query) ||
          b.finalMaturity.includes(query);

        // Series filter
        const matchesSeries = filterSeries === 'All' || b.series === filterSeries;

        // Status filter (Matured = >30 years / past Final Maturity)
        const isMatured = isBondMatured(b.finalMaturity, 2026, 7);
        const matchesStatus = filterStatus === 'All' || 
          (filterStatus === 'Matured' && isMatured) || 
          (filterStatus === 'Active' && !isMatured);

        // Cash out selection filter
        const isMarked = selectedSerials.includes(b.serial);
        const matchesCashOut = filterCashOut === 'All' ||
          (filterCashOut === 'Marked' && isMarked) ||
          (filterCashOut === 'Kept' && !isMarked);

        return matchesSearch && matchesSeries && matchesStatus && matchesCashOut;
      })
      .sort((a, b) => {
        let valA: any = a[sortBy];
        let valB: any = b[sortBy];

        // Format dates correctly for robust comparison
        if (sortBy === 'issueDate' || sortBy === 'finalMaturity') {
          valA = parseDateToMonths(a[sortBy]);
          valB = parseDateToMonths(b[sortBy]);
        }

        if (typeof valA === 'string') {
          valA = valA.toLowerCase();
          valB = valB.toLowerCase();
        }

        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
  }, [bonds, searchQuery, filterSeries, filterStatus, filterCashOut, sortBy, sortDirection, selectedSerials]);

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('desc'); // default to descending for numeric, clean swap
    }
  };

  // --- Dynamic Visualization Calculations ---
  const chartData = useMemo(() => {
    let seriesIVal = 0;
    let seriesEEVal = 0;
    let maturedVal = 0;
    let activeVal = 0;

    bonds.forEach(b => {
      const isMatured = isBondMatured(b.finalMaturity, 2026, 7);
      if (b.series === 'I') seriesIVal += b.value;
      else seriesEEVal += b.value;

      if (isMatured) maturedVal += b.value;
      else activeVal += b.value;
    });

    const total = seriesIVal + seriesEEVal || 1;
    return {
      seriesIPct: (seriesIVal / total) * 100,
      seriesEEPct: (seriesEEVal / total) * 100,
      maturedPct: (maturedVal / total) * 100,
      activePct: (activeVal / total) * 100,
      seriesIVal,
      seriesEEVal,
      maturedVal,
      activeVal
    };
  }, [bonds]);

  return (
    <div className="min-h-screen font-sans transition-colors duration-200 bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      
      {/* Top Banner Notifications */}
      {notification && (
        <div className={`fixed top-4 right-4 z-[60] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm transition-all animate-bounce max-w-md ${
          notification.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-200' :
          notification.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-200' :
          'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-200'
        }`}>
          <Info className="w-5 h-5 flex-shrink-0" />
          <span>{notification.text}</span>
          <button onClick={() => setNotification(null)} className="ml-auto hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Profile Manager Modal */}
      {profileModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          onClick={() => setProfileModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800 p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-500" />
                Manage Profiles
              </h3>
              <button
                onClick={() => setProfileModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
              Each profile keeps its own bonds, selections, and notes on this
              device. Useful when several people share a browser — for example,
              partners, kids, or a side business. Profiles are stored locally in
              your browser only.
            </p>

            {/* Profile list */}
            <div className="space-y-1.5 mb-4 max-h-64 overflow-y-auto">
              {listProfiles().map((p) => {
                const isActive = p.name === currentProfile;
                return (
                  <div
                    key={p.name}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border transition-colors ${
                      isActive
                        ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/20'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <button
                      onClick={() => handleSwitchProfile(p.name)}
                      disabled={isActive}
                      className="flex-1 text-left text-sm font-medium text-slate-800 dark:text-slate-100 disabled:cursor-default cursor-pointer"
                    >
                      {isActive && <span className="text-amber-500">✓ </span>}
                      {p.name}
                    </button>
                    <button
                      onClick={() => {
                        const next = window.prompt(`Rename profile "${p.name}" to:`, p.name);
                        if (next && next.trim() && next.trim() !== p.name) {
                          handleRenameProfile(p.name, next);
                        }
                      }}
                      className="p-1.5 text-slate-400 hover:text-amber-500 rounded"
                      title="Rename profile"
                      aria-label={`Rename ${p.name}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteProfile(p.name)}
                      className="p-1.5 text-slate-400 hover:text-rose-500 rounded"
                      title="Delete profile (and its bonds)"
                      aria-label={`Delete ${p.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Add new profile */}
            <div className="flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="New profile name…"
                className="flex-1 text-sm p-2 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newProfileName.trim()) {
                    handleCreateProfile(newProfileName);
                  }
                }}
              />
              <button
                onClick={() => handleCreateProfile(newProfileName)}
                disabled={!newProfileName.trim()}
                className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Primary Dashboard Header */}
      <header className="sticky top-0 z-40 bg-slate-900 text-white border-b-4 border-amber-500 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          {/* Logo & Identity */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-amber-500 flex items-center justify-center text-slate-900 shadow-lg shadow-amber-500/20">
              <Coins className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold tracking-tight uppercase">
                Savings Bond Wizard <span className="text-amber-500">Pro</span>
              </h1>
              <p className="text-xs text-slate-400 font-sans">
                US Treasury Portfolio Management Utility
              </p>
            </div>
          </div>

          {/* Right Global Actions */}
          <div className="flex flex-wrap items-center gap-2">

            {/* Active Profile Indicator (opens profile manager) */}
            <button
              onClick={() => setProfileModalOpen(true)}
              title={`Active profile: ${currentProfile} — click to manage profiles`}
              className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded text-sm font-medium flex items-center gap-2 border border-slate-600 text-white transition-all shadow-sm cursor-pointer"
            >
              <Users className="w-4 h-4 text-amber-500" />
              <span className="max-w-[140px] truncate">{currentProfile}</span>
            </button>

            {/* Profile-onboarding tooltip pointing at the profile button */}
            {!profileTooltipDismissed && (
              <div
                role="status"
                className="flex items-center gap-1.5 bg-amber-400 dark:bg-amber-500 text-slate-900 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-md whitespace-nowrap"
                title="Click the user-icon button to manage multiple profiles"
              >
                <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Click here to manage multiple profiles</span>
                <button
                  onClick={dismissProfileTooltip}
                  className="ml-0.5 text-slate-900/70 hover:text-slate-900 flex-shrink-0 cursor-pointer"
                  aria-label="Dismiss profile tooltip"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Quick Sample Refresher */}
            <button
              onClick={handleLoadSample}
              title="Reset Portfolio to Sample Bonds (53 Bonds)"
              className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded text-sm font-medium flex items-center gap-2 border border-slate-600 text-white transition-all shadow-sm cursor-pointer"
            >
              <RefreshCw className="w-4 h-4 text-amber-500" />
              <span>Load Sample</span>
            </button>

            {/* Dark Mode Toggle */}
            <button 
              onClick={() => setIsDarkMode(prev => !prev)}
              className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded text-sm font-medium flex items-center gap-2 border border-slate-600 text-white transition-all shadow-sm cursor-pointer"
              title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDarkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-amber-500" />}
              <span>{isDarkMode ? "Light" : "Dark"}</span>
            </button>
            
            <div className="w-px h-6 bg-slate-700 mx-1"></div>

            {/* Clear Button */}
            <button
              onClick={handleClearAll}
              className="bg-slate-700 hover:bg-red-600 hover:border-red-600 px-4 py-2 rounded text-sm font-medium flex items-center gap-2 border border-slate-600 text-white transition-all shadow-sm cursor-pointer"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Clear Portfolio</span>
            </button>
          </div>

        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* Dynamic Warning for Matured Bonds */}
        {stats.maturedCount > 0 && (
          <div className="flex items-start gap-4 p-4 bg-amber-50 border-l-4 border-amber-500 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200 rounded shadow-sm">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-sm uppercase tracking-wide text-slate-900 dark:text-white">Action Needed: {stats.maturedCount} matured bonds detected!</h3>
              <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                US Savings Bonds earn interest for exactly 30 years. Matured bonds are no longer accruing interest. Consider cashing them out and checking your Federal taxes due in the panel below.
              </p>
            </div>
          </div>
        )}

        {/* Professional Polish featured 4-column metrics grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded shadow-sm">
          <div className="p-4 rounded border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total Face Value</p>
            <p className="text-2xl font-mono font-bold text-slate-900 dark:text-white">
              ${stats.faceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <span className="text-xs text-slate-400">Original Denomination</span>
          </div>
          <div className="p-4 rounded border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Current Cash Value</p>
            <p className="text-2xl font-mono font-bold text-slate-900 dark:text-white">
              ${stats.currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <span className="text-xs text-green-600 dark:text-emerald-400 font-bold leading-none">
              +${stats.interest.toLocaleString('en-US', { minimumFractionDigits: 2 })} Interest
            </span>
          </div>
          <div className="p-4 rounded border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-1">Est. Federal Tax Due</p>
            <p className="text-2xl font-mono font-bold text-slate-900 dark:text-white">
              ${taxStats.taxDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {excludeEducation ? "Exempt (College)" : `Based on ${marginalTaxRate}% rate`}
            </span>
          </div>
          <div className="p-4 rounded border border-slate-100 dark:border-slate-800 bg-slate-900 text-white dark:bg-slate-800/80">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Portfolio Yield</p>
            <p className="text-2xl font-mono font-bold text-white">
              {stats.averageRate.toFixed(2)}%
            </p>
            <span className="text-xs text-amber-500 font-bold uppercase tracking-wider">Average Coupon Rate</span>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* ================= LEFT SIDEBAR (Metrics, Graphs, Taxes, Actions) ================= */}
          <div className="lg:col-span-4 space-y-6">

            {/* Panel 1: Key Portfolio Figures */}
            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h2 className="font-display font-bold text-sm tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  Portfolio Highlights
                </h2>
                <span className="font-mono text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full uppercase">
                  {bonds.length} Bonds
                </span>
              </div>

              {/* Bento Grid Metrics */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100/50 dark:border-slate-700/30">
                  <span className="text-[10px] text-slate-400 font-medium block uppercase tracking-wider">Total Value</span>
                  <span className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400">
                    ${stats.currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100/50 dark:border-slate-700/30">
                  <span className="text-[10px] text-slate-400 font-medium block uppercase tracking-wider">Interest Accrued</span>
                  <span className="text-lg font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    +${stats.interest.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100/50 dark:border-slate-700/30">
                  <span className="text-[10px] text-slate-400 font-medium block uppercase tracking-wider">Original Cost</span>
                  <span className="text-base font-mono font-bold text-slate-700 dark:text-slate-300">
                    ${stats.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100/50 dark:border-slate-700/30">
                  <span className="text-[10px] text-slate-400 font-medium block uppercase tracking-wider">Face Value</span>
                  <span className="text-base font-mono font-bold text-slate-700 dark:text-slate-300">
                    ${stats.faceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Custom SVG Distribution Chart */}
              <div className="space-y-3 pt-2">
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Series Distribution (By Value)</span>
                
                {/* Dual Color Progress Bar */}
                <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                  {bonds.length > 0 ? (
                    <>
                      <div 
                        style={{ width: `${chartData.seriesIPct}%` }} 
                        className="bg-emerald-500 h-full hover:opacity-90 transition-all cursor-help"
                        title={`Series I: ${chartData.seriesIPct.toFixed(1)}%`}
                      />
                      <div 
                        style={{ width: `${chartData.seriesEEPct}%` }} 
                        className="bg-indigo-500 h-full hover:opacity-90 transition-all cursor-help"
                        title={`Series EE: ${chartData.seriesEEPct.toFixed(1)}%`}
                      />
                    </>
                  ) : (
                    <div className="w-full h-full bg-slate-200 dark:bg-slate-700" />
                  )}
                </div>

                <div className="flex justify-between text-[11px] font-mono text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    <span>Series I (${chartData.seriesIVal.toLocaleString('en-US', { maximumFractionDigits: 0 })})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                    <span>Series EE (${chartData.seriesEEVal.toLocaleString('en-US', { maximumFractionDigits: 0 })})</span>
                  </div>
                </div>
              </div>

              {/* Maturity Distribution */}
              <div className="space-y-3 pt-1 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Maturity Status (By Value)</span>
                
                <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                  {bonds.length > 0 ? (
                    <>
                      <div 
                        style={{ width: `${chartData.activePct}%` }} 
                        className="bg-blue-500 h-full hover:opacity-90 transition-all cursor-help"
                        title={`Active & Earning: ${chartData.activePct.toFixed(1)}%`}
                      />
                      <div 
                        style={{ width: `${chartData.maturedPct}%` }} 
                        className="bg-amber-500 h-full hover:opacity-90 transition-all cursor-help"
                        title={`Matured (Stopped Earning): ${chartData.maturedPct.toFixed(1)}%`}
                      />
                    </>
                  ) : (
                    <div className="w-full h-full bg-slate-200 dark:bg-slate-700" />
                  )}
                </div>

                <div className="flex justify-between text-[11px] font-mono text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                    <span>Earning (${chartData.activeVal.toLocaleString('en-US', { maximumFractionDigits: 0 })})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    <span>Matured (${chartData.maturedVal.toLocaleString('en-US', { maximumFractionDigits: 0 })})</span>
                  </div>
                </div>
              </div>

              {/* Helpful averages info */}
              <div className="bg-emerald-500/5 border border-emerald-500/10 dark:border-emerald-500/5 text-xs text-slate-600 dark:text-slate-300 p-2.5 rounded-xl flex justify-between items-center font-mono">
                <span>Average Coupon Rate</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">{stats.averageRate.toFixed(2)}%</span>
              </div>
            </section>

            {/* Panel 2: Interactive Federal Tax Estimator */}
            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
              
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h2 className="font-display font-bold text-sm tracking-wide uppercase text-slate-500 dark:text-slate-400">
                    Federal Tax Estimator
                  </h2>
                </div>
                {selectedSerials.length > 0 && (
                  <button 
                    onClick={handleClearTaxSelection}
                    className="text-[11px] font-mono text-rose-500 hover:underline"
                  >
                    Reset Checkboxes
                  </button>
                )}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Savings bond interest is subject to <strong className="text-slate-700 dark:text-slate-300">Federal income tax</strong> but is <strong className="text-slate-700 dark:text-slate-300">100% exempt</strong> from State &amp; Local taxes. Mark specific bonds in the table list to model cashing out.
              </p>

              {/* Tax configuration controls */}
              <div className="space-y-3 bg-slate-50 dark:bg-slate-800/30 p-3 rounded-xl border border-slate-100/50 dark:border-slate-700/30">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex justify-between">
                    <span>Marginal Fed Bracket Rate</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">{marginalTaxRate}%</span>
                  </label>
                  <select 
                    value={marginalTaxRate}
                    onChange={(e) => setMarginalTaxRate(parseInt(e.target.value, 10))}
                    className="w-full text-xs font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 rounded-lg"
                  >
                    <option value={10}>10% Bracket (Single &lt; $11k / Joint &lt; $22k)</option>
                    <option value={12}>12% Bracket (Single &lt; $44k / Joint &lt; $89k)</option>
                    <option value={22}>22% Bracket (Single &lt; $95k / Joint &lt; $190k)</option>
                    <option value={24}>24% Bracket (Single &lt; $182k / Joint &lt; $364k)</option>
                    <option value={32}>32% Bracket (Single &lt; $231k / Joint &lt; $462k)</option>
                    <option value={35}>35% Bracket (Single &lt; $578k / Joint &lt; $693k)</option>
                    <option value={37}>37% Bracket (High Earners &gt; $578k+)</option>
                  </select>
                </div>

                {/* Higher education checkbox option */}
                <div className="flex items-start gap-2 pt-1.5">
                  <input 
                    type="checkbox" 
                    id="educationCheck"
                    checked={excludeEducation}
                    onChange={(e) => setExcludeEducation(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <label htmlFor="educationCheck" className="text-[11px] leading-tight text-slate-600 dark:text-slate-300 select-none cursor-pointer">
                    <strong>Higher Education Exclusion</strong>
                    <span className="block text-slate-400">Are you using proceeds for qualified college tuition? Interest might be 100% tax-free!</span>
                  </label>
                </div>
              </div>

              {/* Tax estimation results display */}
              <div className="space-y-2 pt-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Selected Bonds for Cash-out</span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                    {taxStats.cashoutCount} of {bonds.length}
                  </span>
                </div>
                
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Total Face Denomination</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    ${taxStats.cashoutFace.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Cash-out Redeemed Value</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300 font-bold">
                    ${taxStats.cashoutValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="flex justify-between text-xs border-t border-slate-100 dark:border-slate-800 pt-2">
                  <span className="text-slate-500 flex items-center gap-1">
                    Taxable Accumulated Interest
                    <span className="group relative cursor-help">
                      <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-900 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-center">
                        Tax is paid only on the accrued interest (Redemption Value - Issue Price)
                      </span>
                    </span>
                  </span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                    ${taxStats.cashoutInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-500">Est. Federal Income Tax Due</span>
                  <span className="font-mono text-rose-500 dark:text-rose-400">
                    {excludeEducation ? '$0.00 (Exempt)' : `-$${taxStats.taxDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </span>
                </div>

                <div className="flex justify-between text-sm font-bold border-t-2 border-dashed border-slate-100 dark:border-slate-800 pt-2 text-slate-800 dark:text-slate-100 bg-slate-500/5 p-2 rounded-xl">
                  <span>Net Estimated Proceeds</span>
                  <span className="font-mono text-blue-600 dark:text-blue-400 text-base">
                    ${taxStats.netProceeds.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Informative footer for taxpayers */}
              <details className="text-[10px] text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-2 cursor-pointer select-none">
                <summary className="hover:text-slate-700 dark:hover:text-slate-300 font-medium">
                  Tax Reporting Info &amp; Exclusion Details
                </summary>
                <div className="mt-1.5 space-y-1.5 pl-2 border-l border-emerald-500 leading-normal">
                  <p>
                    <strong>1099-INT Form:</strong> When cashing bonds, the payer bank will report the entire interest amount in Box 3 of Form 1099-INT.
                  </p>
                  <p>
                    <strong>Reporting Methods:</strong> Most investors defer interest reporting until redemption or maturity. However, you can report interest annually as it accrues if preferred.
                  </p>
                  <p>
                    <strong>Education Exemption:</strong> Bonds must be issued in your name (or joint with spouse) and must have been issued after 1989 when you were at least 24 years old.
                  </p>
                </div>
              </details>
            </section>

            {/* Panel 3: Import & Export Operations */}
            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <ArrowRightLeft className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="font-display font-bold text-sm tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  Import &amp; Export Inventory
                </h2>
              </div>

              {/* First-run onboarding tooltip pointing at the drop zone */}
              {!firstRunTooltipDismissed && bonds.length === 0 && (
                <div role="status" className="mb-3 px-3 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/50 rounded-lg flex items-start justify-between gap-2 text-xs text-amber-900 dark:text-amber-200 shadow-sm">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
                    <div>
                      <strong className="block text-[11px] uppercase tracking-wider font-bold">
                        First time here?
                      </strong>
                      <span>
                        Drop an HTML save from{' '}
                        <a
                          href={TREASURY_CALCULATOR_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="underline font-mono font-bold text-blue-700 dark:text-blue-400"
                        >
                          TreasuryDirect
                        </a>{' '}
                        into the box below — or click the box to browse.
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={dismissFirstRunTooltip}
                    className="text-amber-700 dark:text-amber-300 hover:opacity-70 flex-shrink-0 cursor-pointer"
                    aria-label="Dismiss first-run tooltip"
                    title="Got it"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* HTML drag and drop workspace */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                  isDragging 
                    ? 'border-emerald-500 bg-emerald-500/10' 
                    : !firstRunTooltipDismissed && bonds.length === 0
                      ? 'border-amber-400 dark:border-amber-500 ring-4 ring-amber-400/40 dark:ring-amber-500/30 animate-pulse-subtle bg-amber-50/30 dark:bg-amber-950/10'
                      : 'border-slate-200 dark:border-slate-800 hover:border-emerald-500 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept=".html,.htm,.csv"
                  className="hidden" 
                />
                <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Drop files here or click to browse
                </h4>
                <p className="text-[10px] text-slate-400 mt-1">
                  Supports US Treasury HTML files &amp; Portfolio CSV files
                </p>
              </div>

              <div className="text-[11px] text-slate-500 bg-slate-100 dark:bg-slate-800/30 p-3 rounded-xl leading-relaxed space-y-1 border border-slate-200/40 dark:border-slate-700/30">
                <strong className="text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <Info className="w-3.5 h-3.5" />
                  How to get your Treasury HTML file:
                </strong>
                <ol className="list-decimal pl-4 space-y-0.5">
                  <li>Go to the US Treasury Savings Bond Calculator website.</li>
                  <li>Calculate the current value of your paper savings bonds.</li>
                  <li>Click "Save" or "Save as" in your browser.</li>
                  <li>Upload that downloaded HTML file directly here!</li>
                </ol>
              </div>

              {/* Export Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={handleExportHTML}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm"
                  title="Download HTML file compatible with US Treasury Savings Bond website"
                >
                  <FileCode className="w-4 h-4 text-orange-500" />
                  <span>Export HTML</span>
                </button>
                <button
                  onClick={handleExportCSV}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm"
                  title="Download CSV database of your savings bonds"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                  <span>Export CSV</span>
                </button>
              </div>
            </section>

          </div>

          {/* ================= RIGHT PORTFOLIO PANEL (Filters, List, Add Bond) ================= */}
          <div className="lg:col-span-8 space-y-6">

            {/* Quick Filter, Search & Adding Section */}
            <section className="bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
              <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
                
                {/* Unified Search Input */}
                <div className="relative w-full md:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by Serial or Note..."
                    className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 dark:text-white rounded focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 font-mono"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Dropdown Select Filters */}
                <div className="flex flex-wrap gap-2 w-full md:w-auto">
                  
                  {/* Series I vs EE Filter */}
                  <select
                    value={filterSeries}
                    onChange={(e) => setFilterSeries(e.target.value as any)}
                    className="text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 py-1.5 px-3 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <option value="All">All Series</option>
                    <option value="I">Series I</option>
                    <option value="EE">Series EE</option>
                  </select>

                  {/* Maturity status */}
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as any)}
                    className="text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 py-1.5 px-3 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <option value="All">All Maturity Status</option>
                    <option value="Active">Active &amp; Earning</option>
                    <option value="Matured">Matured (Stopped Earning)</option>
                  </select>

                  {/* Cashout status */}
                  <select
                    value={filterCashOut}
                    onChange={(e) => setFilterCashOut(e.target.value as any)}
                    className="text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 py-1.5 px-3 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <option value="All">All Cash-out Status</option>
                    <option value="Marked">Marked for Cash Out</option>
                    <option value="Kept">Retained Portfolio</option>
                  </select>
                </div>

                {/* Add Bond Toggle */}
                <button
                  onClick={() => setIsAddingBond(prev => !prev)}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-900 rounded shadow-sm transition-all w-full md:w-auto justify-center cursor-pointer"
                >
                  {isAddingBond ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  <span>{isAddingBond ? "Cancel" : "New Bond Entry +"}</span>
                </button>

              </div>

              {/* Inline expandable manual addition form */}
              {isAddingBond && (
                <form 
                  onSubmit={handleAddManualBond}
                  className="mt-4 p-4 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 rounded space-y-4 animate-fadeIn"
                >
                  <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800 pb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5 font-display">
                      <Plus className="w-3.5 h-3.5 text-amber-500" />
                      Add Bond Manually
                    </h3>
                    <button 
                      type="button" 
                      onClick={() => setIsAddingBond(false)}
                      className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {formError && (
                    <div className="text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 p-2.5 rounded border border-rose-100 dark:border-rose-900">
                      {formError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    
                    {/* Series Choice */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Series</label>
                      <div className="grid grid-cols-2 gap-1 border border-slate-200 dark:border-slate-700 rounded p-0.5 bg-white dark:bg-slate-800">
                        <button
                          type="button"
                          onClick={() => setFormSeries('I')}
                          className={`py-1 text-xs font-bold rounded ${
                            formSeries === 'I' 
                              ? 'bg-amber-500 text-slate-900' 
                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          Series I
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormSeries('EE')}
                          className={`py-1 text-xs font-bold rounded ${
                            formSeries === 'EE' 
                              ? 'bg-amber-500 text-slate-900' 
                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          Series EE
                        </button>
                      </div>
                    </div>

                    {/* Serial Number */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Serial Number</label>
                      <input 
                        type="text"
                        value={formSerial}
                        onChange={(e) => setFormSerial(e.target.value)}
                        placeholder="e.g. C827841069EE"
                        required
                        className="w-full text-xs font-mono bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 p-2 rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>

                    {/* Denomination Choice */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Face Denomination</label>
                      <select
                        value={formDenomination}
                        onChange={(e) => setFormDenomination(parseFloat(e.target.value))}
                        className="w-full text-xs font-mono bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 p-2 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
                      >
                        <option value={50}>$50</option>
                        <option value={100}>$100</option>
                        <option value={200}>$200</option>
                        <option value={500}>$500</option>
                        <option value={1000}>$1,000</option>
                        <option value={5000}>$5,000</option>
                        <option value={10000}>$10,000</option>
                      </select>
                    </div>

                    {/* Issue Date */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex justify-between">
                        <span>Issue Date</span>
                        <span className="font-normal text-slate-400 lowercase">MM/YYYY</span>
                      </label>
                      <input 
                        type="text"
                        value={formIssueDate}
                        onChange={(e) => setFormIssueDate(e.target.value)}
                        placeholder="MM/YYYY"
                        required
                        className="w-full text-xs font-mono bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 p-2 rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>

                    {/* Interest Rate */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Interest Rate (%)</label>
                      <input 
                        type="number"
                        step="0.01"
                        value={formInterestRate}
                        onChange={(e) => setFormInterestRate(parseFloat(e.target.value) || 0)}
                        required
                        className="w-full text-xs font-mono bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 p-2 rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>

                    {/* Current Value */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Current Value ($)</label>
                      <input 
                        type="number"
                        step="0.01"
                        value={formCurrentValue}
                        onChange={(e) => setFormCurrentValue(parseFloat(e.target.value) || 0)}
                        required
                        className="w-full text-xs font-mono bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 p-2 rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>

                    {/* Note */}
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Note (optional)</label>
                      <input 
                        type="text"
                        value={formNote}
                        onChange={(e) => setFormNote(e.target.value)}
                        placeholder="e.g. Gift from grandparents"
                        className="w-full text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 p-2 rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>

                  </div>

                  {/* Summary of manual calculation prior to saving */}
                  <div className="grid grid-cols-3 gap-2 bg-white dark:bg-slate-800/20 p-2.5 rounded text-[11px] border border-slate-200/40 dark:border-slate-700/30 text-slate-500 font-mono">
                    <div>
                      <span>Final Maturity:</span> <strong className="text-slate-700 dark:text-slate-200">{computeFinalMaturity(formIssueDate)}</strong>
                    </div>
                    <div>
                      <span>Issue Price:</span> <strong className="text-slate-700 dark:text-slate-200">${computedIssuePrice.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>Estimated Interest:</span> <strong className="text-amber-500">{Math.max(0, formCurrentValue - computedIssuePrice).toFixed(2)}</strong>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAddingBond(false)}
                      className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-900 rounded shadow-sm cursor-pointer"
                    >
                      Save Bond
                    </button>
                  </div>
                </form>
              )}
            </section>

            {/* Primary Bonds Table Container */}
            <section className="bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
              
              {/* Header inside container */}
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-display font-bold text-sm tracking-wide text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Wallet className="w-4 h-4 text-amber-500" />
                  Bonds Inventory
                  <span className="font-mono text-xs text-slate-400 font-normal">
                    ({sortedAndFilteredBonds.length} of {bonds.length} listed)
                  </span>
                </h3>
                
                {/* Select All checkbox triggers */}
                {sortedAndFilteredBonds.length > 0 && (
                  <button
                    onClick={() => handleSelectAllFiltered(sortedAndFilteredBonds)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700/60 rounded border border-slate-200/50 dark:border-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    {sortedAndFilteredBonds.every(b => selectedSerials.includes(b.serial)) ? (
                      <>
                        <CheckSquare className="w-3.5 h-3.5 text-amber-500" />
                        <span>Deselect All Listed</span>
                      </>
                    ) : (
                      <>
                        <Square className="w-3.5 h-3.5 text-slate-400" />
                        <span>Select All Listed for Cash Out</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Responsive Table Layout */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-850 text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">
                      <th className="py-3 px-4 w-12 text-center">Cashout</th>
                      <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 select-none" onClick={() => handleSort('serial')}>
                        <div className="flex items-center gap-1">
                          Serial #
                          {sortBy === 'serial' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                        </div>
                      </th>
                      <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 select-none text-center" onClick={() => handleSort('series')}>
                        <div className="flex items-center justify-center gap-1">
                          Series
                          {sortBy === 'series' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                        </div>
                      </th>
                      <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 select-none text-right" onClick={() => handleSort('denomination')}>
                        <div className="flex items-center justify-end gap-1">
                          Denom
                          {sortBy === 'denomination' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                        </div>
                      </th>
                      <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 select-none text-center" onClick={() => handleSort('issueDate')}>
                        <div className="flex items-center justify-center gap-1">
                          Issue Date
                          {sortBy === 'issueDate' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                        </div>
                      </th>
                      <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 select-none text-center" onClick={() => handleSort('finalMaturity')}>
                        <div className="flex items-center justify-center gap-1">
                          Maturity
                          {sortBy === 'finalMaturity' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                        </div>
                      </th>
                      <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 select-none text-right" onClick={() => handleSort('issuePrice')}>
                        <div className="flex items-center justify-end gap-1">
                          Cost
                          {sortBy === 'issuePrice' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                        </div>
                      </th>
                      <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 select-none text-right" onClick={() => handleSort('interest')}>
                        <div className="flex items-center justify-end gap-1">
                          Interest
                          {sortBy === 'interest' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                        </div>
                      </th>
                      <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 select-none text-right animate-pulse-subtle" onClick={() => handleSort('interestRate')}>
                        <div className="flex items-center justify-end gap-1">
                          Rate
                          {sortBy === 'interestRate' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                        </div>
                      </th>
                      <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 select-none text-right" onClick={() => handleSort('value')}>
                        <div className="flex items-center justify-end gap-1">
                          Value
                          {sortBy === 'value' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                        </div>
                      </th>
                      <th className="py-3 px-4 w-40">Note</th>
                      <th className="py-3 px-3 w-10 text-center"></th>
                    </tr>
                  </thead>
                  
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono text-xs">
                    {sortedAndFilteredBonds.length > 0 ? (
                      sortedAndFilteredBonds.map(b => {
                        const isSelected = selectedSerials.includes(b.serial);
                        const isMatured = isBondMatured(b.finalMaturity, 2026, 7);

                        return (
                          <tr 
                            key={b.serial}
                            className={`hover:bg-slate-50/50 dark:hover:bg-slate-850/40 transition-colors ${
                              isSelected 
                                ? 'bg-amber-500/5 dark:bg-amber-500/10' 
                                : isMatured 
                                  ? 'bg-amber-500/[0.02] dark:bg-amber-500/[0.02]' 
                                  : ''
                            }`}
                          >
                            {/* Checkbox */}
                            <td className="py-2 px-4 text-center">
                              <button 
                                type="button"
                                onClick={() => handleToggleSelect(b.serial)}
                                className="inline-flex focus:outline-none hover:scale-110 transition-transform cursor-pointer"
                                title={isSelected ? "Unmark this bond for Cash Out" : "Mark this bond for Cash Out & Tax liability"}
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-amber-500" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                                )}
                              </button>
                            </td>

                            {/* Serial # */}
                            <td className="py-2 px-3 font-semibold text-slate-700 dark:text-slate-300">
                              {b.serial}
                            </td>

                            {/* Series Badge */}
                            <td className="py-2 px-3 text-center">
                              {b.series === 'I' ? (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
                                  I
                                </span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-400">
                                  EE
                                </span>
                              )}
                            </td>

                            {/* Denomination */}
                            <td className="py-2 px-3 text-right text-slate-500 dark:text-slate-400">
                              ${b.denomination.toLocaleString('en-US')}
                            </td>

                            {/* Issue Date */}
                            <td className="py-2 px-3 text-center text-slate-500 dark:text-slate-400">
                              {b.issueDate}
                            </td>

                            {/* Maturity Date */}
                            <td className="py-2 px-3 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-slate-600 dark:text-slate-300">{b.finalMaturity}</span>
                                {isMatured && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.2 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400 rounded-full animate-pulse-subtle">
                                    MATURED
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Cost */}
                            <td className="py-2 px-3 text-right text-slate-500 dark:text-slate-400">
                              ${b.issuePrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>

                            {/* Interest */}
                            <td className="py-2 px-3 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                              +${b.interest.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>

                            {/* Rate */}
                            <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300 font-bold">
                              {b.interestRate.toFixed(2)}%
                            </td>

                            {/* Current Value */}
                            <td className="py-2 px-3 text-right text-blue-600 dark:text-blue-400 font-bold">
                              ${b.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>

                            {/* Notes column (with inline editing) */}
                            <td className="py-2 px-4 max-w-xs truncate text-[11px]">
                              {editingSerial === b.serial ? (
                                <div className="flex items-center gap-1.5">
                                  <input 
                                    type="text"
                                    value={editingNote}
                                    onChange={(e) => setEditingNote(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveNote(b.serial);
                                      if (e.key === 'Escape') setEditingSerial(null);
                                    }}
                                    className="border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px] font-sans text-slate-800 dark:text-white w-full"
                                    autoFocus
                                  />
                                  <button 
                                    onClick={() => handleSaveNote(b.serial)}
                                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 text-emerald-600 rounded"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => setEditingSerial(null)}
                                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 rounded"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="group flex items-center justify-between gap-1.5">
                                  <span className="text-slate-500 dark:text-slate-400 italic">
                                    {b.note || "—"}
                                  </span>
                                  <button 
                                    onClick={() => handleStartEditNote(b.serial, b.note)}
                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded transition-opacity"
                                    title="Edit note"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </td>

                            {/* Deletion action */}
                            <td className="py-2 px-3 text-center">
                              <button
                                onClick={() => handleDeleteBond(b.serial)}
                                className="p-1.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                title="Remove bond from portfolio"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>

                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={12} className="py-8 px-6 text-slate-500 font-sans">
                          {bonds.length === 0 ? (
                            <div className="max-w-3xl mx-auto bg-gradient-to-br from-slate-50 to-amber-50/40 dark:from-slate-900/60 dark:to-amber-950/20 border-2 border-dashed border-amber-300 dark:border-amber-700/50 rounded-xl p-8">
                              <div className="text-center mb-6">
                                <Coins className="w-10 h-10 mx-auto mb-3 text-amber-500" />
                                <h4 className="font-display font-bold text-xl text-slate-800 dark:text-slate-100 mb-2">
                                  Your portfolio is empty
                                </h4>
                                <p className="text-sm text-slate-600 dark:text-slate-300 max-w-xl mx-auto">
                                  Pick a starting option below. The app will not load
                                  sample data behind your back — you choose how it
                                  begins.
                                </p>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 text-left">
                                  <BookOpen className="w-5 h-5 text-amber-500 mb-2" />
                                  <h5 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-1">
                                    Import from TreasuryDirect
                                  </h5>
                                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
                                    Save an HTML report from the official calculator
                                    and drop it on the import area in the sidebar.
                                  </p>
                                  <a
                                    href={TREASURY_CALCULATOR_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-bold"
                                  >
                                    Open calculator →
                                  </a>
                                </div>
                                <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 text-left">
                                  <Plus className="w-5 h-5 text-emerald-500 mb-2" />
                                  <h5 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-1">
                                    Add one manually
                                  </h5>
                                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
                                    Use the amber “New Bond Entry +” button above
                                    to enter a single bond.
                                  </p>
                                </div>
                                <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 text-left">
                                  <RefreshCw className="w-5 h-5 text-indigo-500 mb-2" />
                                  <h5 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-1">
                                    Explore with samples
                                  </h5>
                                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
                                    Try 53 example bonds matching the official
                                    Treasury calculator output.
                                  </p>
                                  <button
                                    onClick={handleLoadSample}
                                    className="text-xs text-amber-700 dark:text-amber-400 hover:underline font-bold cursor-pointer"
                                  >
                                    Load sample portfolio →
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <>
                              <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                              <h4 className="font-semibold text-slate-700 dark:text-slate-300">No Savings Bonds Found</h4>
                              <p className="text-xs mt-1">No bonds match your active search filter criteria.</p>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  
                  {/* Totals Summary Row */}
                  {sortedAndFilteredBonds.length > 0 && (
                    <tfoot className="bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 font-mono text-xs font-bold text-slate-700 dark:text-slate-200">
                      <tr>
                        <td colSpan={3} className="py-3 px-4 text-slate-500 font-sans text-right">
                          Page Totals ({sortedAndFilteredBonds.length} Bonds)
                        </td>
                        <td className="py-3 px-3 text-right">
                          ${sortedAndFilteredBonds.reduce((sum, b) => sum + b.denomination, 0).toLocaleString('en-US')}
                        </td>
                        <td colSpan={2}></td>
                        <td className="py-3 px-3 text-right">
                          ${sortedAndFilteredBonds.reduce((sum, b) => sum + b.issuePrice, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-3 text-right text-emerald-600 dark:text-emerald-400">
                          +${sortedAndFilteredBonds.reduce((sum, b) => sum + b.interest, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td></td>
                        <td className="py-3 px-3 text-right text-blue-600 dark:text-blue-400">
                          ${sortedAndFilteredBonds.reduce((sum, b) => sum + b.value, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

            </section>

            {/* Quick Informational Guide Section */}
            <section className="bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <BookOpen className="w-4 h-4 text-amber-500" />
                <h3 className="font-display font-bold text-sm text-slate-700 dark:text-slate-200">
                  US Savings Bonds Quick Reference &amp; Calculator Guide
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                <div className="space-y-2">
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    Series I Savings Bonds
                  </h4>
                  <p>
                    Purchased at 100% of face value (a $50 bond costs $50). Earning rates are a combination of a fixed rate and an inflation-indexed rate (adjusted semi-annually in May and November). They are designed to protect purchasing power against currency inflation.
                  </p>
                </div>
                
                <div className="space-y-2">
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                    Series EE Savings Bonds
                  </h4>
                  <p>
                    Purchased at 50% of face value (a $100 paper bond costs $50). Paper EE bonds issued since May 2005 have a fixed interest rate, but are legally guaranteed by the US Treasury to double in value exactly 20 years from the issue date.
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/20 p-3 rounded border border-slate-100/50 dark:border-slate-700/50 flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                <Clock className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <p>
                  <strong>Accrual Notes:</strong> Interest is compiled monthly and added to the principal balance semi-annually. If you redeem a bond within the first 5 years of ownership, you lose the most recent 3 months of interest. After 5 years, there is zero penalty.
                </p>
              </div>

              {/* External help link to the official TreasuryDirect calculator instructions */}
              <div className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                <HelpCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <p>
                  For step-by-step instructions on entering your bonds into the official calculator, see the{' '}
                  <a
                    href={TREASURY_CALCULATOR_HELP_URL}

                    aria-label="TreasuryDirect Savings Bond Calculator instructions (opens in new tab)"                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline font-bold"
                  >
                    TreasuryDirect Savings Bond Calculator instructions ↗
                  </a>
                  .
                </p>
              </div>
            
            </section>

          </div>

        </div>

      </main>

      {/* Modern, Simple Footnotes */}
      <footer className="border-t border-slate-200 dark:border-slate-800 mt-12 py-6 bg-white dark:bg-slate-900/40">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-2 text-slate-400 text-[10px] font-mono">
          <p>
            Savings Bond Wizard is an educational companion. It does not replace formal accounting advice or the official US Treasury records.
          </p>
          <p>
            No user or portfolio data is transmitted to remote servers. All calculations and bond storage are processed locally within your secure client browser workspace.
          </p>
        </div>
      </footer>

    </div>
  );
}
