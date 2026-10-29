import React, { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  MENU_DESCRIPTIONS,
  workspaceGroups,
} from "../shared/workspace-navigation.js";
import "./workspace-navigation.css";

export function WorkspaceNavigation({ nav, page, go }) {
  const [expanded, setExpanded] = useState({});
  const groups = workspaceGroups(nav);
  const activeParent = groups.find((group) =>
    group.children.some(([key]) => key === page),
  )?.entry[0];
  useEffect(() => {
    if (activeParent)
      setExpanded((current) => ({ ...current, [activeParent]: true }));
  }, [activeParent, page]);
  function item([key, label, Icon]) {
    return (
      <button
        type="button"
        className={`tenant-nav-link ${page === key ? "active" : ""}`}
        aria-current={page === key ? "page" : undefined}
        title={MENU_DESCRIPTIONS[key]}
        onClick={() => go(key)}
      >
        <Icon size={18} aria-hidden="true" />
        <span>{label}</span>
        {page === key && <span className="nav-dot" />}
      </button>
    );
  }
  return (
    <nav className="tenant-navigation" aria-label="School workspace">
      {groups.map(({ entry, children }) => {
        const [key, label] = entry;
        const open = expanded[key] ?? activeParent === key;
        return (
          <div
            key={key}
            className={`tenant-nav-group ${activeParent === key ? "has-active-child" : ""}`}
          >
            <div className="tenant-nav-row">
              {item(entry)}
              {children.length > 0 && (
                <button
                  type="button"
                  className="tenant-nav-toggle"
                  aria-label={`${open ? "Collapse" : "Expand"} ${label} menu`}
                  title={`${open ? "Hide" : "Show"} ${children.map((child) => child[1]).join(", ")}`}
                  aria-expanded={open}
                  aria-controls={`workspace-menu-${key}`}
                  onClick={() =>
                    setExpanded((current) => ({ ...current, [key]: !open }))
                  }
                >
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              )}
            </div>
            {children.length > 0 && (
              <div
                id={`workspace-menu-${key}`}
                className="tenant-nav-children"
                hidden={!open}
              >
                {children.map((entry) => (
                  <React.Fragment key={entry[0]}>{item(entry)}</React.Fragment>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
