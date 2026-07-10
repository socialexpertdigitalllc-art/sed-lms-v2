// Template Engine — shared types. These interfaces are contracts consumed by
// the runner / API / UI tasks; do not change shapes without updating callers.

export type PageKind =
  | "home"
  | "about"
  | "services_hub"
  | "areas_hub"
  | "gallery"
  | "contact"
  | "service_detail"
  | "area_detail"
  | "other";

export interface ManifestPage {
  file: string;
  title: string;
  kind: PageKind;
}

export interface TemplateManifest {
  pages: ManifestPage[];
  css: string[];
  js: string[];
  components: string | null;
  assets: string[];
  imageFiles: string[];
  totalBytes: number;
}

export interface EditOp {
  file?: string;
  find: string;
  replace: string;
}

export interface GenStep {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "partial";
  started_at?: string;
  ms?: number;
  detail?: string;
}
