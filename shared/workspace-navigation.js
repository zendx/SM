export const WORKSPACE_GROUPS = [
  ["dashboard", []],
  ["admissions", ["students", "attendance"]],
  ["academics", ["finance", "curriculum", "messages", "platform"]],
  ["staff", ["people"]],
  [
    "administration",
    [
      "quality",
      "intelligence",
      "facilities",
      "alerts",
      "reports",
      "subscription",
      "support",
    ],
  ],
];

export const MENU_DESCRIPTIONS = {
  dashboard: "See school activity, setup progress and key figures.",
  admissions: "Manage applications and enroll new students.",
  students: "View student profiles, classes and enrollment records.",
  attendance: "Record and review student attendance.",
  staff: "Manage your staff directory and daily staff attendance.",
  people: "Manage staff documents, leave and HR records.",
  administration:
    "Manage school settings, user accounts, classes and integrations.",
  quality: "Review school feedback, complaints and discipline cases.",
  intelligence: "Explore school insights and historical evaluations.",
  facilities: "Track school facilities, assets and maintenance.",
  alerts: "See school issues that need your attention.",
  academics: "Manage academic records, grades and student results.",
  finance: "Manage school fees, payments and outstanding balances.",
  curriculum: "Plan and track curriculum delivery.",
  messages:
    "Exchange private messages between your school and parents, or send school updates.",
  reports: "Review and export school reports.",
  subscription: "View your school plan, subscription and billing.",
  support: "Get help with your school account.",
  platform: "Open the SaaS business console.",
  teaching: "Open your classes, attendance and teaching tools.",
};

// Missing permission for a parent must never hide an otherwise allowed child.
export function workspaceGroups(nav) {
  const available = new Map(nav.map((entry) => [entry[0], entry]));
  const assigned = new Set();
  const groups = [];
  for (const [key, childKeys] of WORKSPACE_GROUPS) {
    const children = childKeys
      .filter((child) => available.has(child))
      .map((child) => available.get(child));
    if (available.has(key)) {
      groups.push({ entry: available.get(key), children });
      assigned.add(key);
    } else {
      groups.push(...children.map((entry) => ({ entry, children: [] })));
    }
    children.forEach(([child]) => assigned.add(child));
  }
  for (const entry of nav)
    if (!assigned.has(entry[0])) groups.push({ entry, children: [] });
  return groups;
}
