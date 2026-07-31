import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { AgentPeriodicReport } from "@/lib/reports/agentPeriodic";
import type { WindowMetrics } from "@/lib/reports/agentPeriodicMath";
import { formatUsd } from "@/lib/contracts/merge";

const HEADING = "#1c2a4a";
const MUTED = "#666";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9.5, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.4 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", color: HEADING, marginBottom: 2 },
  subtitle: { color: MUTED, marginBottom: 14 },
  section: { marginBottom: 12 },
  h2: { fontSize: 11.5, fontFamily: "Helvetica-Bold", color: HEADING, marginBottom: 5 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#dfe3ec", paddingVertical: 2.5 },
  head: { flexDirection: "row", paddingBottom: 3 },
  cLabel: { flex: 3 },
  cVal: { flex: 1, textAlign: "right", fontFamily: "Helvetica-Bold" },
  cMuted: { flex: 1, textAlign: "right", color: MUTED },
  headText: { flex: 1, textAlign: "right", fontSize: 7.5, color: MUTED, textTransform: "uppercase" },
  headLabel: { flex: 3, fontSize: 7.5, color: MUTED, textTransform: "uppercase" },
  note: { color: "#8a6d1a", marginBottom: 10 },
});

type Fmt = (v: number | null) => string;
const fmtInt: Fmt = (v) => (v === null ? "—" : String(Math.round(v)));
const fmtPct: Fmt = (v) => (v === null ? "—" : `${v.toFixed(0)}%`);
const fmtDays: Fmt = (v) => (v === null ? "—" : v < 2 ? `${Math.round(v * 24)}h` : `${v.toFixed(1)}d`);
const fmtHours: Fmt = (v) => (v === null ? "—" : v < 48 ? `${Math.round(v)}h` : `${(v / 24).toFixed(1)}d`);
const fmtRatio: Fmt = (v) => (v === null ? "—" : v.toFixed(2));

interface RowDef { label: string; get: (m: WindowMetrics) => number | null; fmt: Fmt }

const SECTIONS: { title: string; rows: RowDef[] }[] = [
  {
    title: "Pipeline flow",
    rows: [
      { label: "Leads arrived", get: (m) => m.arrived, fmt: fmtInt },
      { label: "Closed (won)", get: (m) => m.closedCount, fmt: fmtInt },
      { label: "Closed — fresh (arrived this period)", get: (m) => m.closedFresh, fmt: fmtInt },
      { label: "Dropped (lost)", get: (m) => m.droppedCount, fmt: fmtInt },
      { label: "Open at period end", get: (m) => m.openAtEnd, fmt: fmtInt },
      { label: "Open 30+ days", get: (m) => m.openAging.d30p, fmt: fmtInt },
    ],
  },
  {
    title: "Velocity",
    rows: [
      { label: "Median time to close", get: (m) => m.medianCloseDays, fmt: fmtDays },
      { label: "Avg time to close", get: (m) => m.avgCloseDays, fmt: fmtDays },
      { label: "Median time to drop", get: (m) => m.medianDropDays, fmt: fmtDays },
      { label: "Fast drops (≤7d)", get: (m) => m.fastDrops, fmt: fmtInt },
      { label: "Slow drops (>7d)", get: (m) => m.slowDrops, fmt: fmtInt },
      { label: "Median first touch", get: (m) => m.medianFirstTouchHours, fmt: fmtHours },
    ],
  },
  {
    title: "Ratios",
    rows: [
      { label: "Close ratio (of decided)", get: (m) => m.closeRatio, fmt: fmtPct },
      { label: "Drop ratio (of decided)", get: (m) => m.dropRatio, fmt: fmtPct },
      { label: "Pickup rate", get: (m) => m.pickupRate, fmt: fmtPct },
      { label: "Follow-ups logged", get: (m) => m.followUpsLogged, fmt: fmtInt },
      { label: "Contracts sent", get: (m) => m.contractsSent, fmt: fmtInt },
      { label: "Closes per contract sent", get: (m) => m.closesPerContract, fmt: fmtRatio },
    ],
  },
  {
    title: "Revenue (by close date, quoted/contracted)",
    rows: [
      { label: "Closed revenue", get: (m) => m.closedRevenue, fmt: (v) => formatUsd(v) },
      { label: "Recurring (yearly)", get: (m) => m.recurringRevenue, fmt: (v) => formatUsd(v) },
      { label: "Avg deal size", get: (m) => m.avgDealSize, fmt: (v) => formatUsd(v) },
    ],
  },
];

export function ReportDocument({ report }: { report: AgentPeriodicReport }) {
  const m = report.metrics;
  return (
    <Document title={`Agent Periodic Report — ${report.agent.name}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Agent Periodic Report</Text>
        <Text style={styles.subtitle}>
          {report.agent.name}{report.agent.active ? "" : " (deactivated)"} · {report.period.from} → {report.period.to}
        </Text>
        {m.agent.approxCount > 0 && (
          <Text style={styles.note}>
            Note: {m.agent.approxCount} exit timing(s) approximated from legacy data (pre-ledger).
          </Text>
        )}
        {SECTIONS.map((s) => (
          <View key={s.title} style={styles.section} wrap={false}>
            <Text style={styles.h2}>{s.title}</Text>
            <View style={styles.head}>
              <Text style={styles.headLabel}>Metric</Text>
              <Text style={styles.headText}>Agent</Text>
              <Text style={styles.headText}>Team</Text>
              <Text style={styles.headText}>Prev</Text>
            </View>
            {s.rows.map((r) => (
              <View key={r.label} style={styles.row}>
                <Text style={styles.cLabel}>{r.label}</Text>
                <Text style={styles.cVal}>{r.fmt(r.get(m.agent))}</Text>
                <Text style={styles.cMuted}>{r.fmt(r.get(m.team))}</Text>
                <Text style={styles.cMuted}>{r.fmt(r.get(m.prev))}</Text>
              </View>
            ))}
          </View>
        ))}
        <View style={styles.section} wrap={false}>
          <Text style={styles.h2}>Regions (agent)</Text>
          {report.regions.agent.length === 0 ? (
            <Text style={{ color: MUTED }}>No closes or drops in this period.</Text>
          ) : (
            report.regions.agent.map((r) => (
              <View key={r.region} style={styles.row}>
                <Text style={styles.cLabel}>{r.region}</Text>
                <Text style={styles.cVal}>{r.closed} closed</Text>
                <Text style={styles.cMuted}>{r.dropped} dropped</Text>
                <Text style={styles.cMuted}>{fmtDays(r.medianCloseDays)}</Text>
              </View>
            ))
          )}
        </View>
        <View style={styles.section} wrap={false}>
          <Text style={styles.h2}>Activity</Text>
          <View style={styles.row}>
            <Text style={styles.cLabel}>Sites generated (all systems)</Text>
            <Text style={styles.cVal}>{report.generation.total}</Text>
            <Text style={styles.cMuted}></Text>
            <Text style={styles.cMuted}></Text>
          </View>
          {report.attendance && (
            <View style={styles.row}>
              <Text style={styles.cLabel}>Attendance: days / hours / avg late</Text>
              <Text style={styles.cVal}>{report.attendance.days}</Text>
              <Text style={styles.cMuted}>{report.attendance.totalHours.toFixed(1)}h</Text>
              <Text style={styles.cMuted}>{Math.round(report.attendance.avgLateMinutes)}m</Text>
            </View>
          )}
        </View>
      </Page>
    </Document>
  );
}

/** Render the report to a PDF Buffer (server-only). */
export async function renderReportPdf(report: AgentPeriodicReport): Promise<Buffer> {
  return renderToBuffer(<ReportDocument report={report} />);
}
