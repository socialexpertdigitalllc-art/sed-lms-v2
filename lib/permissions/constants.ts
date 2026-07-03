export const PERMISSIONS = [
  { key: "leads.view", name: "View Leads", category: "leads" },
  { key: "leads.create", name: "Create Lead", category: "leads" },
  { key: "leads.edit", name: "Edit Lead", category: "leads" },
  { key: "leads.delete", name: "Delete Lead", category: "leads", is_sensitive: true },
  { key: "leads.status_change", name: "Change Lead Status", category: "leads" },
  { key: "leads.view_all", name: "View All Agents' Leads", category: "leads" },
  { key: "leads.export", name: "Export Leads", category: "leads" },
  { key: "pre_leads.view", name: "View Pre-Leads", category: "pre_leads" },
  { key: "pre_leads.create", name: "Create Pre-Lead", category: "pre_leads" },
  { key: "pre_leads.edit", name: "Edit Pre-Lead", category: "pre_leads" },
  { key: "pre_leads.delete", name: "Delete Pre-Lead", category: "pre_leads", is_sensitive: true },
  { key: "pre_leads.followup", name: "Update Follow-up", category: "pre_leads" },
  { key: "analytics.view", name: "View Analytics", category: "analytics" },
  { key: "analytics.view_webcraft", name: "View WebCraft Analytics", category: "analytics" },
  { key: "analytics.view_deepseek", name: "View DeepSeek Analytics", category: "analytics" },
  { key: "analytics.view_all_agents", name: "View All-Agent Analytics", category: "analytics" },
  { key: "ai_tools.webcraft", name: "Use WebCraft", category: "ai_tools" },
  { key: "ai_tools.deepseek", name: "Use DeepSeek", category: "ai_tools" },
  { key: "wge.manage", name: "Manage Website Engine (WGE)", category: "ai_tools", is_sensitive: true },
  { key: "admin.users.view", name: "View Users", category: "admin" },
  { key: "admin.users.create", name: "Create Users", category: "admin", is_sensitive: true },
  { key: "admin.users.edit", name: "Edit Users", category: "admin" },
  { key: "admin.users.deactivate", name: "Deactivate Users", category: "admin", is_sensitive: true },
  { key: "admin.users.delete", name: "Delete Users", category: "admin", is_sensitive: true },
  { key: "admin.departments.manage", name: "Manage Departments", category: "admin", is_sensitive: true },
  { key: "admin.permissions.manage", name: "Manage Permissions", category: "admin", is_sensitive: true },
  { key: "admin.logs.view", name: "View Activity Log", category: "admin" },
  { key: "admin.import", name: "Import Leads", category: "admin", is_sensitive: true },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_CATEGORIES = ["leads", "pre_leads", "analytics", "ai_tools", "admin"] as const;
