import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ContractSnapshot } from "@/lib/contracts/types";
import { SERVICE_PROVIDER } from "@/lib/contracts/provider";
import { getContractTemplate, nodeText, type ContractTemplate } from "@/lib/contracts/templates";
import { CONTRACT_HEADER_B64, CONTRACT_FOOTER_B64 } from "@/lib/contracts/assets";

// Decode once at module load. react-pdf's {data, format} source is the reliable
// server-side path (data-URI string src silently no-ops for embedded PNGs).
const HEADER_IMG = { data: Buffer.from(CONTRACT_HEADER_B64, "base64"), format: "png" as const };
const FOOTER_IMG = { data: Buffer.from(CONTRACT_FOOTER_B64, "base64"), format: "png" as const };

// Brand palette sampled from the Social Expert Digital letterhead.
const NAVY = "#13275f";
const INK = "#1a1a1a";
const HEADING = "#1c2a4a";

const styles = StyleSheet.create({
  page: { paddingBottom: 54, fontSize: 10.5, fontFamily: "Helvetica", color: INK, lineHeight: 1.5 },

  // Header band — the navy/red banner image with the wordmark overlaid.
  header: { position: "relative" },
  headerImg: { width: 595, height: 203 },
  wordmark: { position: "absolute", top: 34, left: 46, color: "#ffffff", fontSize: 25, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  wordmarkLlc: { position: "absolute", top: 68, left: 49, color: "#ffffff", fontSize: 7, letterSpacing: 5 },

  body: { marginTop: -74, paddingHorizontal: 46 },

  title: { fontSize: 19, fontFamily: "Helvetica-Bold", color: HEADING, textAlign: "center", marginBottom: 16 },

  intro: { marginBottom: 12 },
  introDate: { fontFamily: "Helvetica-Bold" },

  partyLabel: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  partyLine: { marginBottom: 1.5 },
  fieldKey: { fontFamily: "Helvetica-Bold" },
  and: { fontFamily: "Helvetica-Bold", marginVertical: 8 },

  rule: { borderBottomWidth: 1, borderBottomColor: "#cfd6e4", marginVertical: 16 },

  section: { marginBottom: 14 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", color: HEADING, marginBottom: 7 },
  para: { marginBottom: 6 },
  subhead: { fontFamily: "Helvetica-Bold", marginTop: 2, marginBottom: 5 },
  bulletRow: { flexDirection: "row", marginBottom: 4, paddingLeft: 6 },
  bulletDot: { width: 12, color: NAVY },
  bulletText: { flex: 1 },

  sigWrap: { marginTop: 22 },
  sigCol: { marginBottom: 18 },
  sigRole: { fontFamily: "Helvetica-Bold", marginBottom: 4 },
  sigProviderName: { marginBottom: 6 },
  sigImageRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 3 },
  sigImage: { width: 150, height: 52, objectFit: "contain" },
  sigTyped: { fontSize: 22, fontFamily: "Times-Italic" },
  sigBlankLine: { width: 200, borderBottomWidth: 1, borderBottomColor: "#333", height: 14 },
  sigMetaKey: { fontFamily: "Helvetica-Bold" },
  sigMetaRow: { marginBottom: 2 },

  footer: { width: 515, height: 24, marginTop: 20, marginHorizontal: 40 },
});

function Field({ k, v }: { k: string; v: string }) {
  return (
    <Text style={styles.partyLine}>
      <Text style={styles.fieldKey}>{k} </Text>
      {v}
    </Text>
  );
}

function Sections({ template, snapshot }: { template: ContractTemplate; snapshot: ContractSnapshot }) {
  return (
    <>
      {template.sections.map((section) => (
        <View key={section.heading} style={styles.section} wrap={false}>
          <Text style={styles.h2}>{section.heading}</Text>
          {section.nodes.map((node, i) => {
            if (node.kind === "subhead") return <Text key={i} style={styles.subhead}>{node.text}</Text>;
            if (node.kind === "para") return <Text key={i} style={styles.para}>{nodeText(node.text, snapshot)}</Text>;
            return (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{nodeText(node.text, snapshot)}</Text>
              </View>
            );
          })}
        </View>
      ))}
    </>
  );
}

export function ContractDocument({
  snapshot,
  signature,
  templateKey = "standard",
}: {
  snapshot: ContractSnapshot;
  signature: { imageDataUrl?: string; typedName?: string };
  templateKey?: string;
}) {
  const template = getContractTemplate(templateKey);
  return (
    <Document title={`${template.title} — ${snapshot.business_name}`}>
      <Page size="A4" style={styles.page}>
        {/* Letterhead */}
        <View style={styles.header}>
          <Image style={styles.headerImg} src={HEADER_IMG} />
          <Text style={styles.wordmark}>Social Expert Digital</Text>
          <Text style={styles.wordmarkLlc}>L L C</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>{template.title}</Text>

          <Text style={styles.intro}>
            This Service Agreement (&quot;{template.agreementNoun}&quot;) is entered into on{" "}
            <Text style={styles.introDate}>{snapshot.contract_date}</Text>, by and between:
          </Text>

          {/* Parties */}
          <Text style={styles.partyLabel}>Service Provider:</Text>
          <Field k="Company Name:" v={SERVICE_PROVIDER.name} />
          <Field k="Phone:" v={SERVICE_PROVIDER.phone} />
          <Field k="Email:" v={SERVICE_PROVIDER.email} />

          <Text style={styles.and}>AND</Text>

          <Text style={styles.partyLabel}>Client:</Text>
          <Field k="Business Name:" v={snapshot.business_name || "—"} />
          <Field k="Phone:" v={snapshot.business_phone || "—"} />
          <Field k="Email:" v={snapshot.business_email || "—"} />

          <View style={styles.rule} />

          <Sections template={template} snapshot={snapshot} />

          {/* Signatures */}
          <View style={styles.sigWrap} wrap={false}>
            <Text style={styles.h2}>10. Signatures</Text>

            <View style={styles.sigCol}>
              <Text style={styles.sigRole}>Service Provider:</Text>
              <Text style={styles.sigProviderName}>{SERVICE_PROVIDER.name}</Text>
              <View style={styles.sigImageRow}>
                <Text style={styles.sigMetaKey}>Signature: </Text>
                {signature.imageDataUrl ? (
                  <Image style={styles.sigImage} src={signature.imageDataUrl} />
                ) : signature.typedName ? (
                  <Text style={styles.sigTyped}>{signature.typedName}</Text>
                ) : (
                  <View style={styles.sigBlankLine} />
                )}
              </View>
              <Text style={styles.sigMetaRow}><Text style={styles.sigMetaKey}>Name: </Text>{snapshot.agent_name || "—"}</Text>
              <Text style={styles.sigMetaRow}><Text style={styles.sigMetaKey}>Date: </Text>{snapshot.contract_date}</Text>
            </View>

            <View style={styles.sigCol}>
              <Text style={styles.sigRole}>Client:</Text>
              <View style={styles.sigImageRow}>
                <Text style={styles.sigMetaKey}>Signature: </Text>
                <View style={styles.sigBlankLine} />
              </View>
              <Text style={styles.sigMetaRow}><Text style={styles.sigMetaKey}>Name: </Text></Text>
              <Text style={styles.sigMetaRow}><Text style={styles.sigMetaKey}>Date: </Text></Text>
            </View>
          </View>
        </View>

        {/* Footer divider */}
        <Image style={styles.footer} src={FOOTER_IMG} />
      </Page>
    </Document>
  );
}

/** Render the contract to a PDF Buffer (server-only). */
export async function renderContractPdf(
  snapshot: ContractSnapshot,
  signature: { imageDataUrl?: string; typedName?: string },
  templateKey = "standard"
): Promise<Buffer> {
  return renderToBuffer(<ContractDocument snapshot={snapshot} signature={signature} templateKey={templateKey} />);
}
