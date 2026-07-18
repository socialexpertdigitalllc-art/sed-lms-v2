import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { contractLines } from "@/lib/contracts/merge";
import type { ContractSnapshot } from "@/lib/contracts/types";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.5 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#666", marginBottom: 20 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 18, marginBottom: 8 },
  para: { marginBottom: 10 },
  row: { flexDirection: "row", marginBottom: 4 },
  label: { width: 130, color: "#666" },
  value: { flex: 1, fontFamily: "Helvetica-Bold" },
  sigBlock: { marginTop: 40, borderTop: "1 solid #ccc", paddingTop: 16 },
  sigImage: { width: 160, height: 60, objectFit: "contain" },
  sigTyped: { fontSize: 22, fontFamily: "Times-Italic" },
  sigName: { fontSize: 10, color: "#666", marginTop: 4 },
});

// Placeholder contract prose — replace with the exported Google-Doc text.
const INTRO_PARAGRAPHS = [
  "This agreement is made between Social Expert Digital LLC (\"Provider\") and the business named below (\"Client\") for the website services described herein.",
  "The Client agrees to the one-time build fee and, where applicable, the recurring yearly maintenance fee set out below.",
];
const TERMS = [
  "1. Scope: Provider will design and deliver the agreed website deliverables.",
  "2. Payment: The one-time price is due per the agreed schedule; the yearly price recurs annually where applicable.",
  "3. Ownership: On full payment, the delivered site assets transfer to the Client.",
];

export function ContractDocument({
  snapshot,
  signature,
}: {
  snapshot: ContractSnapshot;
  signature: { imageDataUrl?: string; typedName?: string };
}) {
  const lines = contractLines(snapshot);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Website Services Agreement</Text>
        <Text style={styles.subtitle}>Social Expert Digital LLC</Text>

        {INTRO_PARAGRAPHS.map((p, i) => <Text key={i} style={styles.para}>{p}</Text>)}

        <Text style={styles.h2}>Contract details</Text>
        {lines.map((l) => (
          <View key={l.label} style={styles.row}>
            <Text style={styles.label}>{l.label}</Text>
            <Text style={styles.value}>{l.value}</Text>
          </View>
        ))}

        <Text style={styles.h2}>Terms</Text>
        {TERMS.map((t, i) => <Text key={i} style={styles.para}>{t}</Text>)}

        <View style={styles.sigBlock}>
          {signature.imageDataUrl ? (
            <Image style={styles.sigImage} src={signature.imageDataUrl} />
          ) : signature.typedName ? (
            <Text style={styles.sigTyped}>{signature.typedName}</Text>
          ) : (
            <Text style={styles.sigTyped}> </Text>
          )}
          <Text style={styles.sigName}>{snapshot.agent_name || "Social Expert Digital LLC"}</Text>
        </View>
      </Page>
    </Document>
  );
}

/** Render the contract to a PDF Buffer (server-only). */
export async function renderContractPdf(
  snapshot: ContractSnapshot,
  signature: { imageDataUrl?: string; typedName?: string }
): Promise<Buffer> {
  return renderToBuffer(<ContractDocument snapshot={snapshot} signature={signature} />);
}
