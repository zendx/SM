import React from "react";
import { useData } from "../hooks";
import { patch } from "../api";
import { Panel, Form, Loading } from "../components";
export function SiteSettings({ notify }) {
  const legal = useData("/legal/config", null);
  return (
    <div className="admin-settings">
      <Panel
        title="Terms and privacy contact"
        description="Published publicly on the site's legal pages. These settings apply to this server, across its schools."
      >
        {legal.error ? (
          <p role="alert">{legal.error}</p>
        ) : legal.loading ? (
          <Loading />
        ) : (
          <Form
            key={legal.data.updated + legal.data.organization}
            initial={{
              organization: legal.data.organization,
              privacy_email: legal.data.contact,
            }}
            fields={[
              { name: "organization", label: "Legal organization name" },
              {
                name: "privacy_email",
                label: "Privacy contact email",
                type: "email",
              },
            ]}
            onSubmit={async (values) => {
              await patch("/admin/legal", values);
              legal.reload();
              notify("Legal contact details published.");
            }}
          />
        )}
      </Panel>
    </div>
  );
}
