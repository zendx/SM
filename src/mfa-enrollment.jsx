import React, { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { post, get } from "./api";
import { Form, Button } from "./components";

export function MfaEnrollment({ onComplete, onLogout }) {
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState("");
  return (
    <div className="mfa-card">
      <h1>Secure your account</h1>
      <p>
        Your role requires two-step verification. Add SMPIS to your
        authenticator app to continue.
      </p>
      {error && <p className="form-error">{error}</p>}
      {!setup ? (
        <Button
          onClick={async () => {
            try {
              setSetup(await post("/auth/mfa/setup", {}));
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          Set up authenticator
        </Button>
      ) : (
        <>
          <QRCodeSVG
            value={setup.uri}
            size={200}
            role="img"
            aria-label="Authenticator setup QR code"
          />
          <p>
            Manual setup key: <code className="secret-key">{setup.secret}</code>
          </p>
          <Form
            fields={[
              {
                name: "code",
                label: "Authenticator code",
                maxLength: 6,
                wide: true,
              },
            ]}
            submit="Enable and continue"
            onSubmit={async (values) => {
              await post("/auth/mfa/enable", values);
              onComplete(await get("/me"));
            }}
          />
          <p>
            After setup, save recovery codes from Account security. Contact your
            platform operator if you lose access.
          </p>
        </>
      )}
      <Button secondary onClick={onLogout}>
        Sign out
      </Button>
    </div>
  );
}
