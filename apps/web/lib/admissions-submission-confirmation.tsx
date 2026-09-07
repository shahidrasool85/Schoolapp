export type AdmissionsConfirmationView = {
  schoolName: string;
  logoUrl?: string | null;
  heading: string;
  message: string;
  additionalMessage?: string | null;
  button?: { label: string; url: string } | null;
  referenceLabel: string;
  reference?: string | null;
  showSystemReference?: boolean;
};

function isHttpUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://");
}

export function AdmissionsSubmissionConfirmation({ view }: { view: AdmissionsConfirmationView }) {
  const button =
    view.button && view.button.label && view.button.url && isHttpUrl(view.button.url) ? view.button : null;
  const showReference = Boolean(view.showSystemReference !== false && view.reference);

  return (
    <div className="admissions-success">
      <div className="admissions-header-brand">
        {view.logoUrl ? <img className="admissions-logo" src={view.logoUrl} alt="" /> : null}
        <p className="admissions-kicker">{view.schoolName}</p>
      </div>
      <h1>{view.heading}</h1>
      {view.message ? <p className="admissions-confirmation-copy">{view.message}</p> : null}
      {view.additionalMessage ? (
        <p className="admissions-confirmation-copy admissions-confirmation-extra">{view.additionalMessage}</p>
      ) : null}
      {button ? (
        <p className="admissions-confirmation-cta">
          <a className="button" href={button.url} rel="noopener noreferrer" target="_blank">
            {button.label}
          </a>
        </p>
      ) : null}
      {showReference ? (
        <p className="admissions-ref">
          {view.referenceLabel}: {view.reference}
        </p>
      ) : null}
    </div>
  );
}
