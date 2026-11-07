// client/src/app/app/scout/scoutPdf.ts
// Handles Scout Radar PDF export using dynamic imports for jsPDF & AutoTable

export interface ReadyPlayer {
  _id: string;
  name: string;
  sport: string;
  age: number;
  playerId?: string;
  coach?: {
    _id: string;
    name: string;
  } | string;
  attendanceRate: number;
  presentSessions?: number;
  totalSessions?: number;
  matchesPlayed: number;
  hasPerformanceStar?: boolean;
  performanceScore?: number | null;
  matchHistory?: Array<{
    played?: boolean;
    attendanceConflict?: boolean;
    score?: number | null;
  }>;
}

export interface ScoutPdfRowData {
  index: number;
  playerName: string;
  sport: string;
  age: number;
  coach: string;
  attendanceText: string;
  matchesPlayed: number;
  status: string;
}

/**
 * Extracts star status and average performance score.
 */
export function getPlayerStarInfo(p: ReadyPlayer): { hasStar: boolean; perfScore: number | null } {
  let perfScore: number | null = null;
  if (typeof p.performanceScore === 'number') {
    perfScore = p.performanceScore;
  } else if (p.matchHistory && p.matchHistory.length) {
    const scoredMatches = p.matchHistory.filter(
      m => m.played === true && !m.attendanceConflict && m.score !== null && m.score !== undefined
    );
    if (scoredMatches.length) {
      const total = scoredMatches.reduce((acc, m) => acc + Number(m.score), 0);
      perfScore = Math.round((total / scoredMatches.length) * 10) / 10;
    }
  }

  const hasStar = Boolean(
    p.hasPerformanceStar || (perfScore !== null && perfScore >= 15)
  );

  return { hasStar, perfScore };
}

/**
 * Formats coach name cleanly.
 */
export function getCoachDisplayName(coach: any): string {
  if (!coach) return 'Dumka Academy';
  if (typeof coach === 'string') return coach;
  return coach.name || 'Dumka Academy';
}

/**
 * Builds the PDF table rows from the ready player list, applying sport and search filters.
 * Star athletes are marked with "(Star)" appended to their name (no emojis).
 */
export function buildScoutPdfRows(
  players: ReadyPlayer[],
  selectedSport: string = 'all',
  searchQuery: string = ''
): ScoutPdfRowData[] {
  if (!Array.isArray(players) || players.length === 0) {
    return [];
  }

  const filtered = players.filter(p => {
    const matchesSport =
      !selectedSport || selectedSport === 'all' || p.sport?.toLowerCase() === selectedSport.toLowerCase();
    const matchesSearch =
      !searchQuery.trim() || p.name?.toLowerCase().includes(searchQuery.trim().toLowerCase());
    return matchesSport && matchesSearch;
  });

  return filtered.map((p, idx) => {
    const { hasStar } = getPlayerStarInfo(p);
    const displayName = hasStar ? `${p.name} (Star)` : p.name;
    const coachName = getCoachDisplayName(p.coach);
    const attendanceText = `${p.attendanceRate}% (${p.presentSessions || 0}/${p.totalSessions || 0})`;

    return {
      index: idx + 1,
      playerName: displayName,
      sport: p.sport || 'General',
      age: p.age,
      coach: coachName,
      attendanceText,
      matchesPlayed: p.matchesPlayed || 0,
      status: 'Trial Eligible',
    };
  });
}

/**
 * Dynamically imports jsPDF and AutoTable, generates an A4 PDF report, and triggers browser download.
 */
export async function exportScoutRadarPdf(
  players: ReadyPlayer[],
  selectedSport: string = 'all',
  searchQuery: string = ''
): Promise<{ success: boolean; rowCount: number; filename?: string; error?: string }> {
  try {
    const rows = buildScoutPdfRows(players, selectedSport, searchQuery);

    if (rows.length === 0) {
      return { success: false, rowCount: 0, error: 'Nothing to export: no athletes match the current criteria.' };
    }

    // Dynamic import to keep the initial page bundle lean
    const { jsPDF } = await import('jspdf');
    const autoTableModule = await import('jspdf-autotable');
    const autoTable = (autoTableModule.default || autoTableModule) as any;

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const now = new Date();

    // Asia/Kolkata formatted date and time
    const istDateTime = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(now);

    const istDateFile = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const filename = `maidan-desk-scouting-radar-${istDateFile}.pdf`;

    // ── Document Header ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text('Maidan Desk - Scouting Radar', 14, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(5, 150, 105); // emerald-600
    doc.text('Dumka Sports Academy', 14, 26);

    // Meta details
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105); // slate-600
    doc.text(`Generated: ${istDateTime} (IST)`, 14, 34);

    const sportLabel = selectedSport === 'all' ? 'All Sports' : selectedSport.charAt(0).toUpperCase() + selectedSport.slice(1);
    const searchLabel = searchQuery.trim() ? ` • Search: "${searchQuery.trim()}"` : '';
    doc.text(`Sport Filter: ${sportLabel}${searchLabel}`, 14, 39);

    doc.text('Threshold: >=75% attendance and >=2 matches', 14, 44);

    // Summary line
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(6, 78, 59); // dark emerald
    doc.text(`${rows.length} trial-eligible athletes`, 14, 51);

    // ── Table ──
    const tableHead = [['#', 'Player', 'Sport', 'Age', 'Coach', 'Attendance %', 'Matches Played', 'Status']];
    const tableBody = rows.map(r => [
      r.index,
      r.playerName,
      r.sport,
      r.age,
      r.coach,
      r.attendanceText,
      r.matchesPlayed,
      r.status,
    ]);

    autoTable(doc, {
      startY: 56,
      head: tableHead,
      body: tableBody,
      theme: 'grid',
      showHead: 'everyPage',
      headStyles: {
        fillColor: [6, 78, 59], // Dark green
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
        halign: 'left',
      },
      styles: {
        fontSize: 8.5,
        textColor: [30, 41, 59],
        cellPadding: 2.5,
        overflow: 'linebreak',
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 42, fontStyle: 'bold' },
        2: { cellWidth: 24 },
        3: { cellWidth: 12, halign: 'center' },
        4: { cellWidth: 32 },
        5: { cellWidth: 28 },
        6: { cellWidth: 22, halign: 'center' },
        7: { cellWidth: 24, textColor: [5, 150, 105], fontStyle: 'bold' },
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252], // slate-50
      },
      margin: { left: 14, right: 14, bottom: 18 },
    });

    // ── Footers with Page Numbers ──
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(
        `Page ${i} of ${totalPages} • Maidan Desk Scouting Radar • Dumka Sports Academy`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 8,
        { align: 'center' }
      );
    }

    doc.save(filename);
    return { success: true, rowCount: rows.length, filename };
  } catch (err: any) {
    return { success: false, rowCount: 0, error: err.message || 'Failed to export PDF' };
  }
}
