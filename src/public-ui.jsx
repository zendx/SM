import React, { useEffect, useId, useRef, useState } from "react";
import { ArrowUp, Mail, Maximize2, X } from "lucide-react";

export function ZoomImage({ src, alt, priority = false }) {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const timer = useRef(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current.showModal();
    return () => {
      clearTimeout(timer.current);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  const close = () => {
    if (closing) return;
    setClosing(true);
    const finish = () => {
      dialog.current.close();
      setOpen(false);
      setClosing(false);
      trigger.current?.focus({ preventScroll: true });
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else timer.current = setTimeout(finish, 180);
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="public-image-trigger"
        aria-label={`Enlarge image: ${alt}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt={alt}
          width="1440"
          height="1000"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
        />
        <span className="image-zoom-hint">
          <Maximize2 size={15} aria-hidden="true" /> Enlarge
        </span>
      </button>
      {open && (
        <dialog
          ref={dialog}
          className={`public-lightbox ${closing ? "is-closing" : ""}`}
          aria-labelledby={titleId}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="lightbox-content">
            <header>
              <p id={titleId}>{alt}</p>
              <button
                type="button"
                onClick={close}
                aria-label="Close image"
                autoFocus
              >
                <X size={22} aria-hidden="true" />
              </button>
            </header>
            <div className="lightbox-image">
              <img src={src} alt={alt} width="1440" height="1000" />
            </div>
            <p className="lightbox-note">
              Example screen with fictional data. Current layouts may differ.
            </p>
          </div>
        </dialog>
      )}
    </>
  );
}

export function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > 600);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  if (!visible) return null;
  return (
    <button
      type="button"
      className="public-back-top"
      aria-label="Back to top"
      title="Back to top"
      onClick={() => {
        document
          .querySelector(".sales-nav .brand")
          ?.focus({ preventScroll: true });
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
        });
      }}
    >
      <ArrowUp size={19} aria-hidden="true" />
    </button>
  );
}

// Prepare only observed elements; reduced motion and keyboard focus reveal immediately.
export function useViewportEntrance() {
  const root = useRef(null);
  useEffect(() => {
    if (!root.current || !window.IntersectionObserver) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const items = root.current.querySelectorAll(
      ".hero-copy, .hero-evidence, .section-intro, .school-module-index > a, .feature-grid > article, .product-snapshots > figure, .steps-grid > article, .pricing-card, .intelligence-band, .sales-cta, .product-spotlight > div, .product-spotlight > ol, .module-content > div, .module-content > aside, .catalog-toolbar, .catalog-hero > h1, .catalog-hero > p, .product-fit > div",
    );
    let observer;
    const configure = () => {
      observer?.disconnect();
      items.forEach((item) => {
        item.classList.remove("viewport-pending", "viewport-entered");
        item.style.removeProperty("--entrance-delay");
      });
      if (preference.matches) return;
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.remove("viewport-pending");
            entry.target.classList.add("viewport-entered");
            observer.unobserve(entry.target);
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -64px 0px" },
      );
      items.forEach((item) => {
        const siblings = [...item.parentElement.children].filter((child) =>
          [...items].includes(child),
        );
        item.style.setProperty(
          "--entrance-delay",
          `${(siblings.indexOf(item) % 3) * 140}ms`,
        );
        item.classList.add("viewport-pending");
        observer.observe(item);
      });
    };
    const revealFocused = (event) => {
      const item = event.target.closest(".viewport-pending");
      if (!item) return;
      item.classList.remove("viewport-pending");
      observer?.unobserve(item);
    };
    root.current.addEventListener("focusin", revealFocused);
    const container = root.current;
    configure();
    preference.addEventListener("change", configure);
    return () => {
      observer?.disconnect();
      container.removeEventListener("focusin", revealFocused);
      preference.removeEventListener("change", configure);
      items.forEach((item) => {
        item.classList.remove("viewport-pending", "viewport-entered");
        item.style.removeProperty("--entrance-delay");
      });
    };
  }, []);
  return root;
}

export function PublicEnquiries() {
  return (
    <p className="public-enquiries">
      Questions about SMPIS?{" "}
      <a href="mailto:info@smpis.digital">
        <Mail size={17} aria-hidden="true" />
        info@smpis.digital
      </a>
    </p>
  );
}
