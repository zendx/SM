import React from "react";
import logo from "./assets/smpis-logo.png";

export function BrandLogo({ school }) {
  return <img className={school?.logo_data ? 'school-logo' : 'brand-logo'} src={school?.logo_data || logo} alt={school?.logo_data ? `${school.name} logo` : 'SMPIS School Management System'} width="980" height="300" />;
}
