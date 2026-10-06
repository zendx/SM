import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

const helpUrl =
  "https://wa.me/2347077778234?text=" +
  encodeURIComponent(
    "Hi SMPIS! I need help with your school management system.",
  );

export function WhatsAppHelp() {
  const [expanded, setExpanded] = useState(true);
  const root = useRef(null);
  useEffect(() => {
    let cookie;
    const resize = new ResizeObserver(() => position());
    const position = () => {
      const notice = document.querySelector(".cookie-notice");
      if (notice !== cookie) {
        resize.disconnect();
        cookie = notice;
        if (cookie) resize.observe(cookie);
      }
      const bottom = cookie
        ? Math.max(24, innerHeight - cookie.getBoundingClientRect().top + 14)
        : 24;
      root.current?.style.setProperty("--help-bottom", `${bottom}px`);
    };
    const mutations = new MutationObserver(position);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", position);
    position();
    return () => {
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", position);
    };
  }, []);
  return (
    <aside
      ref={root}
      className={`whatsapp-help ${expanded ? "expanded" : ""}`}
      aria-label="SMPIS WhatsApp support"
    >
      {expanded && (
        <div className="whatsapp-greeting">
          <button
            className="icon-btn"
            aria-label="Dismiss help greeting"
            onClick={() => setExpanded(false)}
          >
            <X size={14} />
          </button>
          <strong>Hi, I’m SMPIS!</strong>
          <span>Need a hand with your school?</span>
          <small>Chat with us on WhatsApp.</small>
        </div>
      )}
      <a
        className="whatsapp-launcher"
        href={helpUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Get help from SMPIS on WhatsApp (opens in a new tab)"
      >
        {expanded && (
          <svg
            className="smpis-help-mascot"
            viewBox="0 0 100 110"
            aria-hidden="true"
          >
            <ellipse
              cx="49"
              cy="102"
              rx="27"
              ry="5"
              fill="#193e2c"
              opacity=".12"
            />
            <path
              d="M32 75v17m33-17v17"
              stroke="#224f39"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <rect x="27" y="57" width="44" height="31" rx="13" fill="#82b790" />
            <path
              d="M25 65l-9 11"
              stroke="#285b40"
              strokeWidth="9"
              strokeLinecap="round"
            />
            <g className="mascot-wave">
              <path
                d="M70 65l14-13 4-12"
                stroke="#285b40"
                strokeWidth="9"
                fill="none"
                strokeLinecap="round"
              />
              <circle cx="89" cy="35" r="8" fill="#a5d2a2" />
            </g>
            <rect
              x="17"
              y="24"
              width="64"
              height="40"
              rx="18"
              fill="#d9ecd5"
              stroke="#285b40"
              strokeWidth="3"
            />
            <g className="mascot-eyes">
              <ellipse cx="36" cy="43" rx="3.5" ry="5" fill="#193e2c" />
              <ellipse cx="62" cy="43" rx="3.5" ry="5" fill="#193e2c" />
            </g>
            <path
              d="M43 52q6 6 12 0"
              fill="none"
              stroke="#285b40"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <ellipse cx="27" cy="50" rx="5" ry="3" fill="#a5c99e" />
            <ellipse cx="71" cy="50" rx="5" ry="3" fill="#a5c99e" />
            <path d="M20 20l30-13 30 13-30 12z" fill="#193e2c" />
            <path d="M32 27v7q18 10 36 0v-7" fill="#285b40" />
            <path d="M79 21v15" stroke="#dfba65" strokeWidth="2.5" />
            <circle cx="79" cy="38" r="3" fill="#dfba65" />
            <path
              d="M44 70h10m-5-5v10"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        )}
        <svg
          viewBox="0 0 24 24"
          className="whatsapp-icon"
          aria-hidden="true"
          fill="currentColor"
        >
          <path d="M20.52 3.48A11.94 11.94 0 0012.03 0C5.4 0 .02 5.38.02 12c0 2.12.55 4.19 1.6 6.02L0 24l6.14-1.61A11.98 11.98 0 0012.02 24C18.65 24 24 18.62 24 12a11.9 11.9 0 00-3.48-8.52zM12.02 21.98a9.9 9.9 0 01-5.05-1.38l-.36-.22-3.65.96.97-3.56-.24-.37A9.93 9.93 0 012.02 12c0-5.51 4.49-9.99 10.01-9.99a9.9 9.9 0 017.06 2.92A9.94 9.94 0 0122 12c0 5.5-4.47 9.98-9.98 9.98zm5.48-7.47c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.09 4.49.71.3 1.27.49 1.7.62.72.23 1.37.2 1.89.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35z" />
        </svg>
        <span>{expanded ? "Let’s chat" : "WhatsApp"}</span>
      </a>
    </aside>
  );
}
