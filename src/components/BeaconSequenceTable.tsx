import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { ColumnDef, flexRender, getCoreRowModel, getSortedRowModel, SortingState, useReactTable } from '@tanstack/react-table';

export type EvidenceRef = { type: 'network' | 'dom' | 'analytics' | 'screenshot' | 'log'; pointer: string };

export type BeaconRow = {
  id: string;
  ts: string;
  type: 'IMPRESSION' | 'GPT_RENDER' | 'REQUEST' | 'ID_SYNC' | 'OTHER';
  vendor: string;
  creativeId: string;
  placement: string;
  status?: number;
  url: string;
  slotId?: string;
  frame?: {
    w: number;
    h: number;
    bbox?: { x: number; y: number; w: number; h: number };
    css?: { display?: string; visibility?: string; opacity?: number; transform?: string; position?: string; left?: number; top?: number };
    overlappedPct?: number;
  };
  view?: {
    viewportW?: number;
    viewportH?: number;
    scrollY?: number;
    intersectionRatio?: number;
  };
  evidenceRef?: EvidenceRef;
};

type DerivedRow = BeaconRow & {
  flags: {
    pixelStuffed: boolean;
    zeroDim: boolean;
    hiddenDefinite: boolean;
    hiddenLikely: boolean;
    offscreen: boolean;
    stacked: boolean;
    rapidFire: boolean;
    refreshLoop: boolean;
    outOfView: boolean;
  };
  dupCount: number;
};

type Props = {
  rows: BeaconRow[];
  headerChromePx?: number;
  onJumpToEvidence?: (ref: EvidenceRef) => void;
};

const ROW_HEIGHT = 56;

function computeFlags(row: BeaconRow): DerivedRow['flags'] {
  const w = row.frame?.w ?? 0;
  const h = row.frame?.h ?? 0;
  const area = w * h;
  const css = row.frame?.css || {};
  const bbox = row.frame?.bbox;
  const view = row.view;

  const pixelStuffed = (w <= 5 && h <= 5) || area <= 25;
  const zeroDim = w === 0 || h === 0;
  const hiddenDefinite =
    css.display === 'none' ||
    css.visibility === 'hidden' ||
    css.opacity === 0 ||
    (css.transform || '').toLowerCase().includes('scale(0)');
  const hiddenLikely =
    (css.position === 'fixed' || css.position === 'absolute') &&
    ((css.left ?? 0) <= -5000 || (css.top ?? 0) <= -5000);

  let offscreen = false;
  if (bbox && view?.viewportW && view?.viewportH) {
    const vx = view.viewportW;
    const vy = (view.scrollY ?? 0) + view.viewportH;
    offscreen = bbox.x + bbox.w < 0 || bbox.y + bbox.h < 0 || bbox.x > vx || bbox.y > vy;
  }

  const stacked = (row.frame?.overlappedPct ?? 0) >= 0.6;
  const outOfView = (view?.intersectionRatio ?? 1) < 0.1;

  return {
    pixelStuffed,
    zeroDim,
    hiddenDefinite,
    hiddenLikely,
    offscreen,
    stacked,
    rapidFire: false, // computed later with context
    refreshLoop: false, // computed later with context
    outOfView,
  };
}

function formatTs(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  } catch {
    return ts;
  }
}

function truncate(str: string, len = 32) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 3) + '...' : str;
}

function useVirtualRows(containerRef: React.RefObject<HTMLDivElement>, total: number) {
  const [range, setRange] = useState({ start: 0, end: Math.min(40, total) });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const scrollTop = el.scrollTop;
      const height = el.clientHeight;
      const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
      const end = Math.min(total, start + Math.ceil(height / ROW_HEIGHT) + 10);
      setRange({ start, end });
    };
    onScroll();
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef, total]);
  return range;
}

export const BeaconSequenceTable: React.FC<Props> = ({ rows, headerChromePx = 160, onJumpToEvidence }) => {
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'ts', desc: false }]);
  const [filters, setFilters] = useState({
    duplicatesOnly: false,
    severeOnly: false,
    pixelOnly: false,
    hiddenOnly: false,
    stackingOnly: false,
    rapidOnly: false,
    refreshOnly: false,
    outOfViewOnly: false,
  });
  const [selected, setSelected] = useState<DerivedRow | null>(null);
  const [activeCluster, setActiveCluster] = useState<string | null>(null);

  const derived = useMemo<DerivedRow[]>(() => {
    const dupCounts: Record<string, number> = {};
    rows.forEach((r) => {
      if (r.creativeId) dupCounts[r.creativeId] = (dupCounts[r.creativeId] || 0) + 1;
    });

    // Precompute rapid-fire / refresh loops per creativeId
    const byCreative: Record<string, BeaconRow[]> = {};
    rows.forEach((r) => {
      if (!byCreative[r.creativeId]) byCreative[r.creativeId] = [];
      byCreative[r.creativeId].push(r);
    });
    Object.values(byCreative).forEach((arr) => arr.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()));

    return rows.map((r) => {
      const flags = computeFlags(r);
      // rapid-fire: same creative within 2s
      const list = byCreative[r.creativeId] || [];
      const idx = list.findIndex((x) => x.id === r.id);
      if (idx >= 1) {
        const prev = list[idx - 1];
        if (Math.abs(new Date(r.ts).getTime() - new Date(prev.ts).getTime()) <= 2000) {
          flags.rapidFire = true;
        }
      }
      // refresh loop: more than 3 events for same creative within 10s window
      let windowCount = 0;
      for (let j = Math.max(0, idx - 5); j <= Math.min(list.length - 1, idx + 5); j++) {
        if (Math.abs(new Date(list[j].ts).getTime() - new Date(r.ts).getTime()) <= 10000) windowCount++;
      }
      if (windowCount >= 4) flags.refreshLoop = true;

      return {
        ...r,
        flags,
        dupCount: dupCounts[r.creativeId] || 0,
      };
    });
  }, [rows]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return derived.filter((r) => {
      if (term) {
        const match = [r.creativeId, r.placement, r.vendor, r.url].some((f) => (f || '').toLowerCase().includes(term));
        if (!match) return false;
      }
      if (filters.duplicatesOnly && r.dupCount < 2) return false;
      if (filters.pixelOnly && !r.flags.pixelStuffed) return false;
      if (filters.hiddenOnly && !(r.flags.hiddenDefinite || r.flags.hiddenLikely || r.flags.offscreen)) return false;
      if (filters.stackingOnly && !r.flags.stacked) return false;
      if (filters.rapidOnly && !r.flags.rapidFire) return false;
      if (filters.refreshOnly && !r.flags.refreshLoop) return false;
      if (filters.outOfViewOnly && !r.flags.outOfView) return false;
      if (filters.severeOnly) {
        const severe =
          r.flags.pixelStuffed ||
          r.flags.zeroDim ||
          r.flags.hiddenDefinite ||
          r.flags.stacked ||
          (r.dupCount >= 4) ||
          r.flags.refreshLoop;
        if (!severe) return false;
      }
      if (activeCluster) {
        if (activeCluster.startsWith('dup:')) {
          const id = activeCluster.replace('dup:', '');
          if (r.creativeId !== id) return false;
        } else if (activeCluster === 'pixel' && !r.flags.pixelStuffed) return false;
        else if (activeCluster === 'hidden' && !(r.flags.hiddenDefinite || r.flags.hiddenLikely)) return false;
        else if (activeCluster === 'stacked' && !r.flags.stacked) return false;
        else if (activeCluster === 'rapid' && !r.flags.rapidFire) return false;
        else if (activeCluster === 'refresh' && !r.flags.refreshLoop) return false;
        else if (activeCluster === 'outofview' && !r.flags.outOfView) return false;
      }
      return true;
    });
  }, [derived, search, filters, activeCluster]);

  const columns = useMemo<ColumnDef<DerivedRow>[]>(() => [
    {
      id: 'ts',
      header: 'Timestamp',
      accessorFn: (row) => row.ts,
      cell: ({ row }) => <span className="whitespace-nowrap text-xs text-slate-700">{formatTs(row.original.ts)}</span>,
    },
    {
      id: 'type',
      header: 'Type',
      accessorKey: 'type',
      cell: ({ getValue }) => <span className="text-xs font-medium text-slate-800">{getValue<string>()}</span>,
    },
    {
      id: 'vendor',
      header: 'Vendor',
      accessorKey: 'vendor',
      cell: ({ getValue }) => <span className="text-xs text-slate-700">{getValue<string>()}</span>,
    },
    {
      id: 'creativeId',
      header: 'Creative ID',
      accessorKey: 'creativeId',
      cell: ({ row }) => {
        const dup = row.original.dupCount;
        const bg = dup >= 4 ? 'bg-red-100 text-red-800' : dup >= 2 ? 'bg-orange-100 text-orange-800' : '';
        return (
          <div className="flex items-center gap-2 text-xs">
            <span className={`px-2 py-1 rounded ${bg}`}>{row.original.creativeId || '—'}</span>
            {dup >= 2 && <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">x{dup}</span>}
          </div>
        );
      },
    },
    {
      id: 'placement',
      header: 'Placement',
      accessorKey: 'placement',
      cell: ({ getValue }) => <span className="text-xs text-slate-700">{getValue<string>() || '—'}</span>,
    },
    {
      id: 'frame',
      header: 'Frame (WxH)',
      accessorFn: (row) => `${row.frame?.w ?? 0}x${row.frame?.h ?? 0}`,
      cell: ({ row }) => {
        const f = row.original.frame;
        return <span className="text-xs text-slate-700">{f ? `${f.w}x${f.h}` : '—'}</span>;
      },
    },
    {
      id: 'flags',
      header: 'Flags',
      cell: ({ row }) => {
        const { flags } = row.original;
        const pills: string[] = [];
        if (flags.pixelStuffed) pills.push('Pixel/Tiny');
        if (flags.zeroDim) pills.push('Zero-dim');
        if (flags.hiddenDefinite) pills.push('Hidden');
        else if (flags.hiddenLikely) pills.push('Hidden?');
        if (flags.offscreen) pills.push('Offscreen');
        if (flags.stacked) pills.push('Stacked');
        if (flags.rapidFire) pills.push('Rapid');
        if (flags.refreshLoop) pills.push('Refresh');
        if (flags.outOfView) pills.push('Out-of-view');
        return (
          <div className="flex flex-wrap gap-1">
            {pills.map((p) => (
              <span key={p} className="text-[10px] px-2 py-0.5 bg-rose-50 text-rose-700 rounded border border-rose-100">
                {p}
              </span>
            ))}
            {pills.length === 0 && <span className="text-[10px] text-slate-400">—</span>}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      cell: ({ getValue }) => <span className="text-xs text-slate-700">{getValue<number>() ?? '—'}</span>,
    },
    {
      id: 'url',
      header: 'URL',
      accessorKey: 'url',
      cell: ({ row }) => {
        const full = row.original.url;
        return (
          <div className="flex items-center gap-1 max-w-[260px]">
            <span title={full} className="text-xs text-slate-700 truncate">{truncate(full, 42)}</span>
            <button
              className="text-blue-600 text-[10px] px-1 rounded hover:bg-blue-50"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(full);
              }}
            >
              copy
            </button>
          </div>
        );
      },
    },
  ], []);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const total = table.getRowModel().rows.length;
  const range = useVirtualRows(scrollRef, total);
  const visibleRows = table.getRowModel().rows.slice(range.start, range.end);

  const clusters = useMemo(() => {
    const dupMap: Record<string, number> = {};
    derived.forEach((r) => {
      if (r.creativeId) dupMap[r.creativeId] = (dupMap[r.creativeId] || 0) + 1;
    });
    const dupList = Object.entries(dupMap)
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    const fraud = {
      pixel: derived.filter((r) => r.flags.pixelStuffed).length,
      hidden: derived.filter((r) => r.flags.hiddenDefinite || r.flags.hiddenLikely).length,
      stacked: derived.filter((r) => r.flags.stacked).length,
      rapid: derived.filter((r) => r.flags.rapidFire).length,
      refresh: derived.filter((r) => r.flags.refreshLoop).length,
      outofview: derived.filter((r) => r.flags.outOfView).length,
    };
    return { dupList, fraud };
  }, [derived]);

  const onClusterClick = useCallback((id: string | null) => {
    setActiveCluster(id);
    if (!id) return;
    const idx = filtered.findIndex((r) =>
      id.startsWith('dup:') ? r.creativeId === id.replace('dup:', '')
        : id === 'pixel' ? r.flags.pixelStuffed
        : id === 'hidden' ? (r.flags.hiddenDefinite || r.flags.hiddenLikely)
        : id === 'stacked' ? r.flags.stacked
        : id === 'rapid' ? r.flags.rapidFire
        : id === 'refresh' ? r.flags.refreshLoop
        : id === 'outofview' ? r.flags.outOfView
        : false
    );
    if (idx >= 0 && scrollRef.current) {
      const targetOffset = idx * ROW_HEIGHT;
      scrollRef.current.scrollTo({ top: targetOffset - ROW_HEIGHT, behavior: 'smooth' });
    }
  }, [filtered]);

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center gap-3 px-4 py-2 border-b">
        <input
          className="border rounded px-3 py-2 text-sm w-64"
          placeholder="Search creative, placement, vendor, url"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-2 text-xs">
          {[
            ['duplicatesOnly', 'Duplicates Only'],
            ['severeOnly', 'Severe Only'],
            ['pixelOnly', 'Pixel/Tiny'],
            ['hiddenOnly', 'Hidden/Offscreen'],
            ['stackingOnly', 'Stacking'],
            ['rapidOnly', 'Rapid-Fire'],
            ['refreshOnly', 'Refresh'],
            ['outOfViewOnly', 'Out-of-View'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-1">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={(filters as any)[key]}
                onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.checked }))}
                disabled={key === 'outOfViewOnly' && !derived.some((r) => r.view?.intersectionRatio !== undefined)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex min-h-0" style={{ height: `calc(100vh - ${headerChromePx}px)` }}>
        {/* Left clusters */}
        <div className="w-64 border-r p-3 overflow-auto">
          <h4 className="text-sm font-semibold mb-2">Clusters</h4>
          <div className="mb-3">
            <div className="text-xs font-semibold text-slate-600 mb-1">Duplicate Creative IDs</div>
            <div className="space-y-1">
              {clusters.dupList.length === 0 && <div className="text-xs text-slate-400">None</div>}
              {clusters.dupList.map(([id, count]) => (
                <button
                  key={id}
                  onClick={() => onClusterClick(`dup:${id}`)}
                  className={`w-full text-left text-xs px-2 py-1 rounded ${activeCluster === `dup:${id}` ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-slate-100'}`}
                >
                  {id} <span className="text-slate-500">x{count}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1">Fraud Clusters</div>
            {[
              ['pixel', 'Pixel/Tiny'],
              ['hidden', 'Hidden/Offscreen'],
              ['stacked', 'Stacked'],
              ['rapid', 'Rapid-Fire'],
              ['refresh', 'Refresh'],
              ['outofview', 'Out-of-View'],
            ].map(([id, label]) => {
              const count = (clusters.fraud as any)[id] || 0;
              return (
                <button
                  key={id}
                  onClick={() => onClusterClick(id)}
                  className={`w-full text-left text-xs px-2 py-1 rounded flex justify-between ${activeCluster === id ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-slate-100'}`}
                  disabled={count === 0}
                >
                  <span>{label}</span>
                  <span className="text-slate-500">x{count}</span>
                </button>
              );
            })}
          </div>
          <button className="mt-3 text-xs text-blue-600 hover:underline" onClick={() => onClusterClick(null)}>Clear cluster</button>
        </div>

        {/* Table */}
        <div className="flex-1 min-w-0 border-r flex flex-col">
          <div className="flex-1 overflow-auto" ref={scrollRef}>
            <table className="min-w-full table-fixed border-collapse">
              <thead className="sticky top-0 bg-white shadow-sm">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((header) => (
                      <th
                        key={header.id}
                        onClick={header.column.getToggleSortingHandler()}
                        className="text-xs font-semibold text-slate-600 px-3 py-2 border-b cursor-pointer select-none"
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {{
                            asc: '↑',
                            desc: '↓',
                          }[header.column.getIsSorted() as string] || null}
                        </div>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody style={{ position: 'relative' }}>
                <tr style={{ height: range.start * ROW_HEIGHT, border: 'none' }} />
                {visibleRows.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-slate-50 cursor-pointer"
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => setSelected(r.original)}
                  >
                    {r.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 border-b align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr style={{ height: (total - range.end) * ROW_HEIGHT, border: 'none' }} />
              </tbody>
            </table>
          </div>
        </div>

        {/* Details drawer */}
        <div className="w-80 p-3 overflow-auto">
          <h4 className="text-sm font-semibold mb-2">Details</h4>
          {!selected && <div className="text-xs text-slate-400">Click a row to view details</div>}
          {selected && (
            <div className="space-y-2 text-xs">
              <div className="flex gap-2">
                <button className="px-2 py-1 bg-slate-100 rounded" onClick={() => navigator.clipboard.writeText(selected.creativeId || '')}>Copy Creative</button>
                <button className="px-2 py-1 bg-slate-100 rounded" onClick={() => navigator.clipboard.writeText(selected.placement || '')}>Copy Placement</button>
                <button className="px-2 py-1 bg-slate-100 rounded" onClick={() => navigator.clipboard.writeText(selected.url || '')}>Copy URL</button>
                {selected.evidenceRef && onJumpToEvidence && (
                  <button className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded" onClick={() => onJumpToEvidence(selected.evidenceRef!)}>
                    Jump to Evidence
                  </button>
                )}
              </div>
              <div className="bg-slate-50 rounded p-2 overflow-auto max-h-[60vh]">
                <pre className="text-[11px] leading-snug text-slate-700 whitespace-pre-wrap break-all">
                  {JSON.stringify(selected, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BeaconSequenceTable;


