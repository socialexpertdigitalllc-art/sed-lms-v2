export interface AppNotification {
  id: string;
  event_key: string;
  lead_id: string | null;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
}
