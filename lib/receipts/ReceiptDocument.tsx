import type { ComponentProps } from "react";
import { Document, Font, Page, Path, Svg, Text as PdfText, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { RECEIPT_COMPANY } from "@/lib/receipts/company";
import { RECEIPT_LOGO_B64, SIGNATURE_FONT_B64 } from "@/lib/receipts/assets";
import {
  formatLongDate,
  formatMoney,
  itemDisplayTitle,
  lineAmount,
  paymentLine,
} from "@/lib/receipts/compute";
import type { ReceiptDoc } from "@/lib/receipts/types";

// Decode once at module load. react-pdf's {data, format} source is the reliable
// server-side path for embedded PNGs (see lib/contracts/ContractDocument.tsx).
const LOGO = { data: Buffer.from(RECEIPT_LOGO_B64, "base64"), format: "png" as const };

// Handwriting face for the signature only; everything else is built-in Helvetica.
Font.register({ family: "GreatVibes", src: `data:font/woff;base64,${SIGNATURE_FONT_B64}` });

// Never hyphenate: react-pdf's default English hyphenation splits emails and
// names ("billing@socialex-pertdigitalllc.com"). Per-Text, so contracts are untouched.
const noHyphens = (word: string) => [word];
function Text(props: ComponentProps<typeof PdfText>) {
  return <PdfText hyphenationCallback={noHyphens} {...props} />;
}

const NAVY = "#1b2a4e";
const RED = "#c8102e";
const GREEN = "#1f8a4c";
const INK = "#1f2433";
const MUTED = "#5b6475";
const FAINT = "#8a92a3";
const PANEL = "#f3f5fa";
const LINE = "#d9dee8";

const styles = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 50, paddingHorizontal: 38, fontSize: 9.5, fontFamily: "Helvetica", color: INK, lineHeight: 1.35 },

  // Letterhead
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
  logo: { width: 52, height: 52, marginRight: 11 },
  companyName: { fontSize: 18, fontFamily: "Helvetica-Bold", color: NAVY, lineHeight: 1.1 },
  tagline: { marginTop: 3, fontSize: 7.5, fontFamily: "Helvetica-Bold", color: RED, letterSpacing: 1.2 },
  blurb: { marginTop: 3, fontSize: 8.5, color: MUTED },
  pillars: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: INK },
  contact: { alignItems: "flex-end" },
  contactRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 2 },
  contactKey: { fontSize: 6.5, color: FAINT, letterSpacing: 1.2, marginRight: 6 },
  contactVal: { fontSize: 8.5, color: INK },
  stamp: {
    marginTop: 6, marginRight: 6, paddingVertical: 2, paddingHorizontal: 11,
    borderWidth: 2.2, borderColor: GREEN, borderRadius: 4, transform: "rotate(-8deg)",
  },
  stampText: { fontSize: 15, fontFamily: "Helvetica-Bold", color: GREEN, letterSpacing: 2.5 },
  headRule: { marginTop: 9, borderBottomWidth: 2, borderBottomColor: NAVY },

  // Title + meta
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 10 },
  titleWrap: { flexDirection: "row", alignItems: "center" },
  titleBar: { width: 4, height: 22, backgroundColor: RED, marginRight: 9 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", color: NAVY },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "baseline", marginBottom: 2 },
  metaKey: { fontSize: 6.5, color: FAINT, letterSpacing: 1.2, marginRight: 8 },
  metaVal: { fontSize: 9, fontFamily: "Helvetica-Bold", color: INK },
  metaPaid: { fontSize: 9, fontFamily: "Helvetica-Bold", color: GREEN, letterSpacing: 0.6 },

  // Bill to / project panels
  panels: { flexDirection: "row", marginTop: 10 },
  panel: { flex: 1, backgroundColor: PANEL, borderLeftWidth: 3, borderLeftColor: NAVY, paddingVertical: 8, paddingHorizontal: 12 },
  panelGap: { width: 10 },
  panelLabel: { fontSize: 6.5, color: FAINT, letterSpacing: 1.2, marginBottom: 4 },
  panelName: { fontSize: 11.5, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 3 },
  panelLine: { fontSize: 8.5, color: MUTED, marginBottom: 1 },

  // Line items
  table: { marginTop: 10 },
  thead: { flexDirection: "row", backgroundColor: NAVY, paddingVertical: 5, paddingHorizontal: 10 },
  th: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#ffffff", letterSpacing: 0.8 },
  tr: { flexDirection: "row", paddingVertical: 5.5, paddingHorizontal: 10, borderBottomWidth: 0.75, borderBottomColor: LINE },
  colDesc: { flex: 1, paddingRight: 10 },
  colQty: { width: 40, textAlign: "center" },
  colRate: { width: 70, textAlign: "right" },
  colAmt: { width: 76, textAlign: "right" },
  itemTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: INK },
  itemDesc: { marginTop: 1.5, fontSize: 7.5, color: MUTED, lineHeight: 1.3 },
  td: { fontSize: 9, color: INK },

  // Totals
  totals: { alignSelf: "flex-end", width: 250, marginTop: 6 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3.5, paddingHorizontal: 10, borderBottomWidth: 0.75, borderBottomColor: LINE, borderBottomStyle: "dashed" },
  totalKey: { fontSize: 9, color: MUTED },
  totalVal: { fontSize: 9, color: INK },
  grand: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: NAVY, paddingVertical: 7, paddingHorizontal: 12, marginTop: 5 },
  grandKey: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#ffffff", letterSpacing: 0.8 },
  grandVal: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#ffffff" },

  // Payment & coverage
  coverage: { marginTop: 10, borderWidth: 0.75, borderColor: LINE, paddingVertical: 7, paddingHorizontal: 12 },
  coverageTitle: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: MUTED, letterSpacing: 1.2, marginBottom: 5 },
  check: { flexDirection: "row", alignItems: "flex-start", marginBottom: 3 },
  checkIcon: { width: 10, height: 10, marginRight: 7, marginTop: 1 },
  checkText: { flex: 1, fontSize: 8.5, color: INK },
  checkLabel: { fontFamily: "Helvetica-Bold" },

  // Sign-off
  signoff: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12 },
  thanks: { width: 270 },
  thanksTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 4 },
  thanksText: { fontSize: 8, color: MUTED },
  thanksEmail: { fontFamily: "Helvetica-Bold", color: INK },
  sign: { width: 200, alignItems: "center" },
  signName: { fontFamily: "GreatVibes", fontSize: 26, color: INK, lineHeight: 1.1 },
  signLine: { alignSelf: "stretch", borderBottomWidth: 0.9, borderBottomColor: INK, marginTop: 2 },
  signRole: { marginTop: 5, fontSize: 7, fontFamily: "Helvetica-Bold", color: MUTED, letterSpacing: 1.3 },
  signCompany: { marginTop: 2, fontSize: 7, color: FAINT, letterSpacing: 1.1 },

  // Fixed footer band on every page
  footer: { position: "absolute", left: 38, right: 38, bottom: 20, backgroundColor: NAVY, paddingVertical: 6 },
  footerText: { fontSize: 6.8, fontFamily: "Helvetica-Bold", color: "#ffffff", letterSpacing: 1.2, textAlign: "center" },
});

/** Navy disc with a white tick (Helvetica has no check-mark glyph). */
function CheckIcon() {
  return (
    <Svg viewBox="0 0 20 20" style={styles.checkIcon}>
      <Path d="M10 0a10 10 0 1 0 0 20a10 10 0 1 0 0-20z" fill={NAVY} />
      <Path d="M5.5 10.4l3 3 6-6.4" stroke="#ffffff" strokeWidth={2.2} fill="none" />
    </Svg>
  );
}

/** "Label: rest" renders the label bold, like the sample's coverage lines. */
function CoverageLine({ text }: { text: string }) {
  const i = text.indexOf(": ");
  const label = i > 0 && i < 60 ? text.slice(0, i + 1) : null;
  return (
    <View style={styles.check} wrap={false}>
      <CheckIcon />
      <Text style={styles.checkText}>
        {label ? <Text style={styles.checkLabel}>{label} </Text> : null}
        {label ? text.slice(i + 2) : text}
      </Text>
    </View>
  );
}

export function ReceiptDocument({ doc }: { doc: ReceiptDoc }) {
  const c = RECEIPT_COMPANY;
  const { totals } = doc;
  const showBusiness = doc.billToBusiness && doc.billToBusiness !== doc.billToName;

  return (
    <Document title={`Payment Receipt ${doc.receiptNo}`} author={c.name} subject={`Payment receipt for ${doc.billToBusiness}`}>
      <Page size="LETTER" style={styles.page}>
        {/* Letterhead */}
        <View style={styles.head}>
          <View style={styles.brand}>
            <Image src={LOGO} style={styles.logo} />
            <View>
              <Text style={styles.companyName}>{c.name}</Text>
              <Text style={styles.tagline}>{c.tagline.toUpperCase()}</Text>
              <Text style={styles.blurb}>{c.blurb}</Text>
              <Text style={styles.pillars}>{c.pillars}</Text>
            </View>
          </View>
          <View style={styles.contact}>
            <View style={styles.contactRow}>
              <Text style={styles.contactKey}>EMAIL</Text>
              <Text style={styles.contactVal}>{c.email}</Text>
            </View>
            <View style={styles.contactRow}>
              <Text style={styles.contactKey}>WEB</Text>
              <Text style={styles.contactVal}>{c.website}</Text>
            </View>
            <View style={styles.contactRow}>
              <Text style={styles.contactKey}>PHONE</Text>
              <Text style={styles.contactVal}>{c.phone}</Text>
            </View>
            <View style={styles.stamp}>
              <Text style={styles.stampText}>PAID</Text>
            </View>
          </View>
        </View>
        <View style={styles.headRule} />

        {/* Title + receipt meta */}
        <View style={styles.titleRow}>
          <View style={styles.titleWrap}>
            <View style={styles.titleBar} />
            <Text style={styles.title}>Payment Receipt</Text>
          </View>
          <View>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>RECEIPT NO.</Text>
              <Text style={styles.metaVal}>{doc.receiptNo}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>DATE ISSUED</Text>
              <Text style={styles.metaVal}>{formatLongDate(doc.issuedOn)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>STATUS</Text>
              <Text style={styles.metaPaid}>PAID IN FULL</Text>
            </View>
          </View>
        </View>

        {/* Bill to / project */}
        <View style={styles.panels}>
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>BILL TO</Text>
            <Text style={styles.panelName}>{doc.billToName || doc.billToBusiness}</Text>
            {showBusiness ? <Text style={styles.panelLine}>{doc.billToBusiness}</Text> : null}
            {doc.billToEmail ? <Text style={styles.panelLine}>Email: {doc.billToEmail}</Text> : null}
            {doc.billToPhone ? <Text style={styles.panelLine}>Phone: {doc.billToPhone}</Text> : null}
          </View>
          <View style={styles.panelGap} />
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>PROJECT DETAILS</Text>
            <Text style={styles.panelName}>{doc.projectTitle}</Text>
            <Text style={styles.panelLine}>Project ID: {doc.projectRef}</Text>
            <Text style={styles.panelLine}>Service start: {formatLongDate(doc.paidOn)}</Text>
          </View>
        </View>

        {/* Line items */}
        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={[styles.th, styles.colDesc]}>DESCRIPTION</Text>
            <Text style={[styles.th, styles.colQty]}>QTY</Text>
            <Text style={[styles.th, styles.colRate]}>RATE</Text>
            <Text style={[styles.th, styles.colAmt]}>AMOUNT</Text>
          </View>
          {doc.items.map((item, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <View style={styles.colDesc}>
                <Text style={styles.itemTitle}>{itemDisplayTitle(item)}</Text>
                {item.description ? <Text style={styles.itemDesc}>{item.description}</Text> : null}
              </View>
              <Text style={[styles.td, styles.colQty]}>{item.qty}</Text>
              <Text style={[styles.td, styles.colRate]}>{formatMoney(item.rate)}</Text>
              <Text style={[styles.td, styles.colAmt]}>{formatMoney(lineAmount(item))}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}>
            <Text style={styles.totalKey}>Subtotal</Text>
            <Text style={styles.totalVal}>{formatMoney(totals.subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalKey}>Discount</Text>
            <Text style={styles.totalVal}>{totals.discount > 0 ? `-${formatMoney(totals.discount)}` : formatMoney(0)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalKey}>Tax ({Number(totals.taxRate.toFixed(2))}%)</Text>
            <Text style={styles.totalVal}>{formatMoney(totals.taxAmount)}</Text>
          </View>
          <View style={styles.grand}>
            <Text style={styles.grandKey}>TOTAL PAID</Text>
            <Text style={styles.grandVal}>{formatMoney(totals.total)}</Text>
          </View>
        </View>

        {/* Payment & coverage */}
        <View style={styles.coverage} wrap={false}>
          <Text style={styles.coverageTitle}>PAYMENT &amp; COVERAGE</Text>
          <CoverageLine text={`Payment: ${paymentLine(doc.paymentMethod, doc.paymentReference, doc.paidOn)}`} />
          {doc.notes.map((n, i) => (
            <CoverageLine key={i} text={n} />
          ))}
        </View>

        {/* Thanks + signature */}
        <View style={styles.signoff} wrap={false}>
          <View style={styles.thanks}>
            <Text style={styles.thanksTitle}>Thank you for your business.</Text>
            <Text style={styles.thanksText}>
              We appreciate your trust in {c.name}. This receipt confirms payment in full of the amount above.
            </Text>
            <Text style={styles.thanksText}>
              Questions? Email <Text style={styles.thanksEmail}>{c.email}</Text>
            </Text>
          </View>
          <View style={styles.sign}>
            <Text style={styles.signName}>{doc.signerName || " "}</Text>
            <View style={styles.signLine} />
            <Text style={styles.signRole}>AUTHORIZED SIGNATURE</Text>
            <Text style={styles.signCompany}>{c.name.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {`${c.name.toUpperCase()}  ·  THANK YOU FOR CHOOSING US  ·  ${c.website.toUpperCase()}`}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderReceiptPdf(doc: ReceiptDoc): Promise<Buffer> {
  return renderToBuffer(<ReceiptDocument doc={doc} />);
}
