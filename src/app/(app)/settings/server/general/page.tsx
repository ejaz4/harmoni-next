"use client";

import { useState } from "react";
import { ui } from "@/components/ui";
import { Card, Group, settingsStyles as s } from "../../parts";
import { AdminPage } from "../admin";

export default function GeneralPage() {
  return (
    <AdminPage title="General">
      {(settings, save) => (
        <Group id="identity" title="Identity">
          <Card>
            <TextSetting key={settings.name} label="Server name" note="Shown on the sign-in page and around the app." value={settings.name} max={40} onSave={(name) => save({ name }, "Name saved")} />
            <TextSetting
              key={settings.welcome}
              label="Sign-in message"
              note="Shown on the sign-in page. Optional."
              value={settings.welcome}
              max={200}
              multiline
              onSave={(welcome) => save({ welcome }, "Message saved")}
            />
          </Card>
        </Group>
      )}
    </AdminPage>
  );
}

function TextSetting({ label, note, value, max, multiline, onSave }: { label: string; note: string; value: string; max: number; multiline?: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value); // the parent remounts it when `value` changes
  const dirty = draft.trim() !== value;
  const Field = multiline ? "textarea" : "input";
  return (
    <form
      className={s.field}
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) onSave(draft.trim());
      }}
    >
      <label className={s.fieldLabel} htmlFor={`field-${label}`}>
        {label}
      </label>
      <Field id={`field-${label}`} className={s.input} value={draft} maxLength={max} onChange={(e) => setDraft(e.target.value)} />
      <div className={s.fieldFoot}>
        <span>{note}</span>
        {dirty && <button className={`${ui.button} ${ui.buttonSmall} ${ui.buttonPrimary}`}>Save</button>}
      </div>
    </form>
  );
}
