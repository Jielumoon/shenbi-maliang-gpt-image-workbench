import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CircleMinus,
  ExternalLink,
  ImageUp,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { ApiError, api, type ImageProvenanceCheckResult, type ImageProvenanceSignal } from "../api";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import { OPENAI_VERIFY_WEB_URL } from "../lib/imageProvenance";

const FALLBACK_ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const FALLBACK_MAX_FILE_BYTES = 20 * 1024 * 1024;

function formattedFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function signalTitle(signal: ImageProvenanceSignal, t: (key: string) => string) {
  return signal.type === "c2pa" ? t("provenance.signal.c2pa") : t("provenance.signal.synthid");
}

function SignalCard({ signal }: { signal: ImageProvenanceSignal }) {
  const { t } = useI18n();
  const detected = signal.outcome === "detected";
  return (
    <article className={cx("provenance-signal-card", detected && "detected")}>
      <div className="provenance-signal-heading">
        <span className="provenance-signal-icon" aria-hidden="true">
          {detected ? <CheckCircle2 size={19} /> : <CircleMinus size={19} />}
        </span>
        <div>
          <strong>{signalTitle(signal, t)}</strong>
          <span>{detected ? t("provenance.outcome.detected") : t("provenance.outcome.notDetected")}</span>
        </div>
      </div>
      {signal.validationState || signal.issuer || signal.model || signal.generatedAt ? (
        <dl className="provenance-signal-details">
          {signal.validationState ? <><dt>{t("provenance.validation")}</dt><dd>{signal.validationState}</dd></> : null}
          {signal.issuer ? <><dt>{t("provenance.issuer")}</dt><dd>{signal.issuer}</dd></> : null}
          {signal.model ? <><dt>{t("provenance.model")}</dt><dd>{signal.model}</dd></> : null}
          {signal.generatedAt ? <><dt>{t("provenance.generatedAt")}</dt><dd>{signal.generatedAt}</dd></> : null}
        </dl>
      ) : null}
    </article>
  );
}

function ResultPanel({ result }: { result: ImageProvenanceCheckResult }) {
  const { resolvedLanguage, t } = useI18n();
  const checkedAt = new Intl.DateTimeFormat(resolvedLanguage, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(result.createdAt * 1000));
  return (
    <section className={cx("provenance-result", result.detected ? "detected" : "not-detected")} aria-live="polite">
      <header className="provenance-result-summary">
        <span className="provenance-result-icon" aria-hidden="true">
          {result.detected ? <CheckCircle2 size={25} /> : <CircleMinus size={25} />}
        </span>
        <div>
          <h2>{result.detected ? t("provenance.detected") : t("provenance.notDetected")}</h2>
          <p>{result.detected ? t("provenance.detectedDesc") : t("provenance.notDetectedDesc")}</p>
          <small>{t("provenance.checkedAt", { time: checkedAt })}</small>
        </div>
      </header>
      <div className="provenance-signal-grid">
        {result.results.map((signal, index) => <SignalCard key={`${signal.type}-${index}`} signal={signal} />)}
      </div>
    </section>
  );
}

export function ImageProvenancePage() {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileError, setFileError] = useState("");
  const capabilities = useQuery({
    queryKey: ["image-provenance-capabilities"],
    queryFn: api.imageProvenanceCapabilities,
    staleTime: 60_000
  });
  const check = useMutation({ mutationFn: api.checkImageProvenance });
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const acceptedTypes = capabilities.data?.acceptedMimeTypes ?? FALLBACK_ACCEPTED_TYPES;
  const maximumBytes = capabilities.data?.maxFileBytes ?? FALLBACK_MAX_FILE_BYTES;
  const requestError = check.error instanceof Error
    ? check.error.message
    : check.error
      ? t("provenance.requestFailed")
      : "";
  const apiAccessUnavailable = check.error instanceof ApiError && check.error.status === 424;

  const selectFile = (next: File | null) => {
    check.reset();
    setFileError("");
    if (!next) return;
    if (!acceptedTypes.includes(next.type)) {
      setFile(null);
      setFileError(t("provenance.invalidType"));
      return;
    }
    if (next.size <= 0) {
      setFile(null);
      setFileError(t("provenance.emptyFile"));
      return;
    }
    if (next.size > maximumBytes) {
      setFile(null);
      setFileError(t("provenance.tooLarge"));
      return;
    }
    setFile(next);
  };

  const clearFile = () => {
    check.reset();
    setFile(null);
    setFileError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <section className="page-section image-provenance-page">
      <PageHeader title={t("provenance.title")} desc={t("provenance.desc")} />
      <article className="provenance-upload-card">
        {capabilities.isLoading ? (
          <div className="provenance-tool-loading">
            <LoaderCircle className="spin" size={22} />
            <span>{t("common.loading")}</span>
          </div>
        ) : !capabilities.data?.configured ? (
          <div className="provenance-web-fallback">
            <span className="provenance-upload-icon" aria-hidden="true"><ShieldCheck size={27} /></span>
            <strong>{t("provenance.webTitle")}</strong>
            <span>{t("provenance.webDesc")}</span>
            <small>{t("provenance.fileLimit")}</small>
            <a className="primary-btn provenance-official-link" href={OPENAI_VERIFY_WEB_URL} target="_blank" rel="noreferrer">
              {t("provenance.webAction")}<ExternalLink size={16} />
            </a>
          </div>
        ) : (
          <>
          {!file ? (
            <label
              className={cx("provenance-dropzone", dragActive && "drag-active")}
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                selectFile(event.dataTransfer.files[0] ?? null);
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept={acceptedTypes.join(",")}
                onChange={(event) => selectFile(event.currentTarget.files?.[0] ?? null)}
              />
              <span className="provenance-upload-icon" aria-hidden="true"><ImageUp size={28} /></span>
              <strong>{t("provenance.uploadTitle")}</strong>
              <span>{t("provenance.uploadDesc")}</span>
              <small>{t("provenance.fileLimit")}</small>
              <span className="primary-btn provenance-pick-button">{t("provenance.choose")}</span>
            </label>
          ) : (
            <div className="provenance-file-preview">
              <div className="provenance-preview-stage"><img src={previewUrl} alt={file.name} /></div>
              <div className="provenance-file-meta">
                <strong title={file.name}>{file.name}</strong>
                <span>{formattedFileSize(file.size)} · {file.type}</span>
              </div>
              <div className="provenance-file-actions">
                <button className="secondary-btn" type="button" onClick={() => inputRef.current?.click()} disabled={check.isPending}>
                  <RefreshCw size={16} />{t("provenance.replace")}
                </button>
                <button className="secondary-btn danger" type="button" onClick={clearFile} disabled={check.isPending}>
                  <Trash2 size={16} />{t("provenance.remove")}
                </button>
              </div>
              <input
                ref={inputRef}
                className="provenance-hidden-input"
                type="file"
                accept={acceptedTypes.join(",")}
                onChange={(event) => selectFile(event.currentTarget.files?.[0] ?? null)}
              />
            </div>
          )}

          {fileError ? <div className="provenance-inline-error"><AlertTriangle size={17} />{fileError}</div> : null}
          {requestError ? <div className="provenance-inline-error"><AlertTriangle size={17} />{requestError}</div> : null}
          {apiAccessUnavailable ? (
            <div className="provenance-api-fallback">
              <div>
                <strong>{t("provenance.apiFallbackTitle")}</strong>
                <span>{t("provenance.apiFallbackDesc")}</span>
              </div>
              <a className="secondary-btn" href={OPENAI_VERIFY_WEB_URL} target="_blank" rel="noreferrer">
                {t("provenance.webAction")}<ExternalLink size={15} />
              </a>
            </div>
          ) : null}
          <button
            className="primary-btn provenance-submit"
            type="button"
            disabled={!file || check.isPending}
            onClick={() => file && check.mutate(file)}
          >
            {check.isPending ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
            {check.isPending ? t("provenance.checking") : t("provenance.check")}
          </button>
          </>
        )}
      </article>

      <div className="provenance-notes">
        <p><strong>{t("provenance.scope")}</strong> {t("provenance.scopeDesc")}</p>
        <p>{t("provenance.originalHint")}</p>
        <p>{t("provenance.privacyDesc")} {t("provenance.retentionNote")}</p>
        <div className="provenance-note-links">
          <a href={OPENAI_VERIFY_WEB_URL} target="_blank" rel="noreferrer">{t("provenance.webLink")}</a>
          <a href="https://developers.openai.com/api/docs/guides/content-provenance" target="_blank" rel="noreferrer">OpenAI Docs</a>
        </div>
      </div>

      {check.data ? <ResultPanel result={check.data} /> : null}
    </section>
  );
}
