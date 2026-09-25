"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { CircleAlertIcon, EyeIcon, EyeOffIcon, FlaskConicalIcon, LockIcon } from "lucide-react";
import { toast } from "sonner";
import { connect, type ConnectField, type ConnectState } from "@/app/setup/actions";
import {
  CONNECT_FIELDS,
  connectSchema,
  fieldErrorsOf,
  normalizeAccessKey,
  normalizeBucket,
  validateField,
  type ConnectValues,
} from "@/app/setup/schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { DisconnectButton } from "./disconnect-button";
import { parseCredentialPaste } from "./paste";
import { PermissionsPanel } from "./permissions-panel";

export interface SetupFormProps {
  connected: boolean;
  mockMode: boolean;
  defaults: { accessKeyId: string; bucket: string };
  // The saved connection, shown in settings mode.
  connection?: { bucket: string; region: string; regionName?: string } | null;
}

type Errors = Partial<Record<ConnectField, string>>;
type FocusTarget = { field: ConnectField };

const SLOW_AFTER_MS = 8000;
const KEYS_HELP_URL = "https://docs.aws.amazon.com/IAM/latest/UserGuide/access-keys-admin-managed.html";

const inputClass =
  "h-11 border-line-2 px-3 hover:border-line-3 sm:h-9 dark:bg-surface-2 aria-invalid:hover:border-destructive";

function firstInvalid(errors: Errors): ConnectField | undefined {
  return CONNECT_FIELDS.find((f) => errors[f]);
}

function ids(...parts: (string | false | undefined)[]): string | undefined {
  const out = parts.filter(Boolean).join(" ");
  return out || undefined;
}

function Field({
  id,
  label,
  aside,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  className?: string;
  label: string;
  aside?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <div className="flex min-h-5 items-center justify-between gap-3">
        <Label htmlFor={id} className="text-text-1">
          {label}
        </Label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex gap-1.5 text-[13px] leading-5 text-danger">
          <CircleAlertIcon aria-hidden className="mt-[3px] size-3.5 shrink-0" />
          <span className="min-w-0 text-pretty">{error}</span>
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] leading-5 text-pretty text-text-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SetupForm({ connected, mockMode, defaults, connection }: SetupFormProps) {
  const [state, formAction, pending] = useActionState<ConnectState, FormData>(connect, { values: defaults });

  const [values, setValues] = useState<ConnectValues>({ ...defaults, secretAccessKey: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [serverField, setServerField] = useState<ConnectField | undefined>();
  const [secretCleared, setSecretCleared] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [slow, setSlow] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [seenState, setSeenState] = useState(state);

  const accessKeyRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);
  const bucketRef = useRef<HTMLInputElement>(null);

  const titleId = useId();
  const alertId = "connect-error";
  const secretOptional = connected;

  // A new result from the server action: adopt its errors (adjusting state during render,
  // so there's no extra paint with stale errors).
  if (state !== seenState) {
    setSeenState(state);
    if (state.fieldErrors) {
      setErrors(state.fieldErrors);
      setServerField(undefined);
      const f = firstInvalid(state.fieldErrors);
      if (f) setFocusTarget({ field: f });
    } else if (state.error) {
      // The secret is never sent back to the browser, so ask for it again.
      setValues((v) => ({ ...v, secretAccessKey: "" }));
      setSecretCleared(!secretOptional);
      setErrors({});
      setServerField(state.error.field);
      setFocusTarget({ field: state.error.field ?? (secretOptional ? "accessKeyId" : "secretAccessKey") });
    }
  }

  useEffect(() => {
    if (!focusTarget) return;
    const el = {
      accessKeyId: accessKeyRef,
      secretAccessKey: secretRef,
      bucket: bucketRef,
    }[focusTarget.field].current;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  }, [focusTarget]);

  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [pending]);

  function update(field: ConnectField, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    if (errors[field]) setErrors((e) => ({ ...e, [field]: validateField(field, next, { secretOptional }) }));
    if (serverField === field) setServerField(undefined);
    if (field === "secretAccessKey" && value) setSecretCleared(false);
  }

  function onAccessKeyChange(e: ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    const raw = el.value;
    const caret = el.selectionStart ?? raw.length;
    const next = normalizeAccessKey(raw);
    update("accessKeyId", next);
    if (next !== raw) {
      const pos = normalizeAccessKey(raw.slice(0, caret)).length;
      requestAnimationFrame(() => el.setSelectionRange(pos, pos));
    }
  }

  function onCredentialPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pair = parseCredentialPaste(e.clipboardData.getData("text"));
    if (!pair) return;
    e.preventDefault();
    setValues((v) => ({ ...v, ...pair }));
    setErrors((er) => ({ ...er, accessKeyId: undefined, secretAccessKey: undefined }));
    setSecretCleared(false);
    if (serverField === "accessKeyId" || serverField === "secretAccessKey") setServerField(undefined);
    toast.success("Filled in both keys", { description: "The pasted text held the access key ID and the secret." });
    bucketRef.current?.focus();
  }

  function onBucketPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!/:\/\/|^arn:|amazonaws\.com/i.test(text.trim())) return;
    e.preventDefault();
    update("bucket", normalizeBucket(text));
  }

  function onBucketBlur() {
    const normalized = normalizeBucket(values.bucket);
    if (normalized !== values.bucket) update("bucket", normalized);
  }

  function onSecretKey(e: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setShowSecret(false);

    const parsed = connectSchema({ secretOptional }).safeParse(values);
    if (!parsed.success) {
      const fe = fieldErrorsOf(parsed.error);
      setErrors(fe);
      setServerField(undefined);
      const f = firstInvalid(fe);
      if (f) setFocusTarget({ field: f });
      return;
    }

    const input = parsed.data;
    setValues((v) => ({ ...v, accessKeyId: input.accessKeyId, bucket: input.bucket }));
    setErrors({});
    setServerField(undefined);
    setSlow(false);

    const fd = new FormData();
    fd.set("accessKeyId", input.accessKeyId);
    fd.set("secretAccessKey", input.secretAccessKey);
    fd.set("bucket", input.bucket);
    startTransition(() => formAction(fd));
  }

  const invalid = (f: ConnectField) => Boolean(errors[f]) || serverField === f;
  const describe = (f: ConnectField, hasHint: boolean) =>
    ids(errors[f] ? `${f}-error` : hasHint && `${f}-hint`, serverField === f && alertId);

  const policyBucket = (() => {
    const b = normalizeBucket(values.bucket);
    return validateField("bucket", { ...values, bucket: b }) ? null : b;
  })();

  const secretHint = capsLock
    ? "Caps Lock is on."
    : secretCleared
      ? "Enter the secret again. It isn’t kept after a failed attempt."
      : undefined;

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border border-line-1 bg-surface-1 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04),0_24px_64px_-24px_rgb(0_0_0/0.6)]"
    >
      <div className="grid grid-cols-1 gap-4 p-4 sm:gap-5 sm:p-6">
        <header className="grid gap-1">
          <h1 id={titleId} className="text-lg leading-7 font-semibold tracking-[-0.01em] text-text-1">
            {connected ? "Connection settings" : "Connect a bucket"}
          </h1>
          {mockMode ? (
            <p className="flex items-start gap-2 text-[13px] leading-5 text-pretty text-text-2 sm:text-sm">
              <FlaskConicalIcon aria-hidden className="mt-[3px] size-3.5 shrink-0 text-brand" />
              <span>
                <span className="font-medium text-text-1">Demo mode.</span> Any keys connect to sample files.
              </span>
            </p>
          ) : (
            <p className="text-sm text-pretty text-text-2">
              {connected
                ? "New details are checked with AWS before they’re saved."
                : "Use an IAM access key that can read the bucket."}
            </p>
          )}
        </header>

        {connected && connection ? (
          <div className="flex items-center gap-3 rounded-lg border border-line-1 bg-surface-2 py-2 pr-2 pl-3.5">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span
                aria-hidden
                className="mt-[7px] size-2 shrink-0 rounded-full bg-brand shadow-[0_0_0_3px_var(--brand-mist)]"
              />
              <div className="grid min-w-0 gap-0.5">
                <p className="font-mono text-[13px] leading-5 break-all text-text-1 sm:text-sm">
                  <span className="sr-only">Connected to </span>
                  {connection.bucket}
                </p>
                <p className="text-xs leading-5 text-text-3 sm:text-[13px]">
                  <span className="font-mono text-text-2">{connection.region}</span>
                  {connection.regionName ? ` · ${connection.regionName}` : null}
                </p>
              </div>
            </div>
            <DisconnectButton disabled={pending} />
          </div>
        ) : null}

        {state.error ? (
          <Alert id={alertId} variant="destructive" className="has-[>svg]:gap-x-3">
            <CircleAlertIcon aria-hidden className="shrink-0" />
            {/* leading-[1.5]: the body line height the title had before Alert's text-sm. */}
            <AlertTitle className="min-w-0 leading-[1.5]">{state.error.title}</AlertTitle>
            <AlertDescription className="min-w-0 text-[13px] leading-5">{state.error.message}</AlertDescription>
          </Alert>
        ) : null}

        <form
          action={formAction}
          onSubmit={onSubmit}
          noValidate
          aria-busy={pending}
          aria-describedby={state.error ? alertId : undefined}
          className="grid gap-5"
        >
          <fieldset disabled={pending} className="grid min-w-0 grid-cols-1 gap-4">
            <legend className="sr-only">AWS credentials and bucket</legend>

            <Field
              id="accessKeyId"
              label="Access key ID"
              error={errors.accessKeyId}
              aside={
                <a
                  href={KEYS_HELP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="-my-2 rounded-sm py-2 text-[13px] text-text-3 underline-offset-4 transition-colors hover:text-text-1 hover:underline"
                >
                  Where to find keys<span className="sr-only"> (opens in a new tab)</span>
                </a>
              }
            >
              <Input
                ref={accessKeyRef}
                id="accessKeyId"
                name="accessKeyId"
                value={values.accessKeyId}
                onChange={onAccessKeyChange}
                onPaste={onCredentialPaste}
                placeholder="AKIA…"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={256}
                data-1p-ignore
                data-lpignore="true"
                aria-invalid={invalid("accessKeyId") || undefined}
                aria-describedby={describe("accessKeyId", false)}
                className={cn(inputClass, "font-mono")}
              />
            </Field>

            <Field
              id="secretAccessKey"
              label="Secret access key"
              error={errors.secretAccessKey}
              hint={secretHint}
            >
              <InputGroup className={cn("h-11 border-line-2 hover:border-line-3 sm:h-9 dark:bg-surface-2")}>
                <InputGroupInput
                  ref={secretRef}
                  id="secretAccessKey"
                  name="secretAccessKey"
                  type={showSecret ? "text" : "password"}
                  value={values.secretAccessKey}
                  onChange={(e) => update("secretAccessKey", e.target.value)}
                  onPaste={onCredentialPaste}
                  onKeyDown={onSecretKey}
                  onKeyUp={onSecretKey}
                  onBlur={() => setCapsLock(false)}
                  placeholder={secretOptional ? "Saved. Leave blank to keep it." : "Paste the secret"}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={512}
                  data-1p-ignore
                  data-lpignore="true"
                  aria-invalid={invalid("secretAccessKey") || undefined}
                  aria-describedby={ids(
                    describe("secretAccessKey", Boolean(secretHint)),
                    secretOptional && !errors.secretAccessKey && "secretAccessKey-keep",
                  )}
                  className="h-full px-3 font-mono placeholder:font-sans"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-sm"
                    aria-label="Show secret access key"
                    aria-pressed={showSecret}
                    aria-controls="secretAccessKey"
                    onClick={() => setShowSecret((s) => !s)}
                    className="-my-px size-11 text-text-3 transition-colors hover:text-text-1 sm:my-0 sm:size-7"
                  >
                    {showSecret ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {secretOptional ? (
                <span id="secretAccessKey-keep" className="sr-only">
                  Leave blank to keep the saved secret.
                </span>
              ) : null}
            </Field>

            <Field
              id="bucket"
              label="Bucket name"
              error={errors.bucket}
              hint="The region is detected automatically."
            >
              <Input
                ref={bucketRef}
                id="bucket"
                name="bucket"
                value={values.bucket}
                onChange={(e) => update("bucket", e.target.value)}
                onPaste={onBucketPaste}
                onBlur={onBucketBlur}
                placeholder="your-bucket-name"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={2048}
                aria-invalid={invalid("bucket") || undefined}
                aria-describedby={describe("bucket", true)}
                className={cn(inputClass, "font-mono")}
              />
            </Field>

          </fieldset>

          <div className="grid gap-3">
            <div className="flex gap-3">
              {connected ? (
                <Button
                  asChild
                  variant="outline"
                  className="h-11 border-line-2 px-4 transition-colors sm:h-9 dark:bg-transparent dark:hover:bg-surface-2"
                >
                  <Link
                    href="/browse"
                    aria-disabled={pending || undefined}
                    tabIndex={pending ? -1 : undefined}
                    className={cn(pending && "pointer-events-none opacity-50")}
                  >
                    Cancel
                  </Link>
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={pending}
                className="h-11 flex-1 border-brand-line bg-brand-strong px-4 text-on-brand transition-colors hover:bg-brand-strong-hover disabled:opacity-70 sm:h-9"
              >
                {pending ? <Spinner aria-hidden className="size-4" /> : null}
                {pending ? "Connecting…" : connected ? "Save and reconnect" : "Connect"}
              </Button>
            </div>
            <p aria-hidden={pending && slow} className="flex items-start gap-2 text-[13px] leading-5 text-pretty text-text-3">
              {pending && slow ? (
                <>
                  <Spinner aria-hidden className="mt-[3px] size-3.5 shrink-0" />
                  <span>Still waiting for AWS. Slow networks can take up to a minute.</span>
                </>
              ) : (
                <>
                  <LockIcon aria-hidden className="mt-[3px] size-3.5 shrink-0" />
                  <span>Stored in an encrypted, httpOnly cookie. Sent only to AWS.</span>
                </>
              )}
            </p>
            <p role="status" aria-live="polite" className="sr-only">
              {pending ? (slow ? "Still waiting for AWS." : "Connecting to the bucket…") : ""}
            </p>
          </div>
        </form>
      </div>

      <div className="grid grid-cols-1 border-t border-line-1 px-4 py-1 sm:px-6 sm:py-2">
        <PermissionsPanel bucket={policyBucket} />
      </div>

    </section>
  );
}
