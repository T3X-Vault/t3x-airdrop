import { useEffect, useState } from "react";
import { SignedIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { assignWallet, bindHandle, checkPost, claimCoins, finishProof, getMine, getPulse, startProof } from "@/lib/airdrop.functions";

type Row = { handle: string; score: number; prize: string };
type Drop = { tweetId: string; coins: number; claimed: boolean };

type Pulse = { week: string; resetAt: string; board: Row[] };
type Mine = Pulse & {
  needsX: boolean;
  handle: string | null;
  address: string | null;
  balance: number;
  waiting: number;
  tags?: number;
  earned?: number;
  drops: Drop[];
};

export function Board() {
  const { user, isPending } = useCurrentUserState();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [handle, setHandle] = useState("");
  const [address, setAddress] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<{ handle: string; text: string; intent: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [embed, setEmbed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setEmbed(new URLSearchParams(window.location.search).get("embed") === "1");
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isPending) return;
    if (!user) {
      getPulse()
        .then(setPulse)
        .catch(() => setNote("The board could not load."));
      return;
    }
    getMine()
      .then((next) => {
        setMine(next);
        setPulse(next);
        if (next.address) setAddress(next.address);
      })
      .catch(() => setNote("Sign in with X to open your coins."));
  }, [user, isPending]);

  const view = mine ?? pulse;
  const left = view ? Math.max(0, Date.parse(view.resetAt) - now) : 0;
  const clock = parts(left);

  async function begin() {
    setBusy(true);
    setNote("");
    try {
      const result = await startProof({ data: handle });
      if (!result.ok) setNote(result.error);
      else setProof({ handle: result.handle, text: result.text, intent: result.intent, code: result.code });
    } catch {
      setNote("Could not start sign-in.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setNote("");
    try {
      const result = await finishProof({ data: { url: link, code: proof?.code || "" } });
      if (!result.ok) setNote(result.error);
      else {
        if (result.token) window.sessionStorage.setItem("grok-auth.bearer-token", result.token);
        window.location.assign("/");
      }
    } catch {
      setNote("Could not finish sign-in.");
    } finally {
      setBusy(false);
    }
  }

  async function saveHandle() {
    setBusy(true);
    setNote("");
    try {
      const result = await bindHandle({ data: handle });
      if (!result.ok) setNote(result.error);
      else {
        setNote(`@${result.handle} is on the board.`);
        setMine(await getMine());
      }
    } catch {
      setNote("Sign in with X first.");
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    setBusy(true);
    setNote("");
    try {
      const result = await checkPost({ data: link });
      if (!result.ok) setNote(result.error);
      else {
        setLink("");
        setNote(result.added.length ? `Counted ${result.added.join(" ")}. The same tag will not count again.` : "Those tags already count.");
        setMine(await getMine());
      }
    } catch {
      setNote("Sign in with X first.");
    } finally {
      setBusy(false);
    }
  }

  async function saveWallet() {
    setBusy(true);
    setNote("");
    try {
      const result = await assignWallet({ data: address });
      if (!result.ok) setNote(result.error);
      else {
        setAddress(result.address);
        setNote("Wallet assigned.");
        setMine(await getMine());
      }
    } catch {
      setNote("Sign in with X first.");
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    setBusy(true);
    setNote("");
    try {
      const result = await claimCoins();
      setNote(result.error ? result.error : result.gained ? `${result.gained} T3X claimed.` : "Nothing waiting this week.");
      setMine(await getMine());
    } catch {
      setNote("Sign in with X first.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`mx-auto grid w-full max-w-3xl gap-6 px-4 py-5 ${embed ? "" : "min-h-dvh max-w-6xl gap-8 px-5 py-8 lg:grid-cols-2 lg:items-start lg:gap-16"}`}>
      {!embed && (
      <section>
        <img src="/brand/t3x-coin.png" alt="" className="h-20 w-20 object-contain" />
        <p className="mt-4 font-display text-5xl leading-none text-fg">T3X</p>
        <p className="mt-3 max-w-sm text-base text-muted">Sign in with X. Each tag counts once. 1 T3X is paid for every 2 tags.</p>
        <div className="mt-6 grid max-w-md grid-cols-3 gap-3">
          <ClockCell label="Hours" value={view ? clock.hours : "--"} />
          <ClockCell label="Minutes" value={view ? clock.minutes : "--"} />
          <ClockCell label="Seconds" value={view ? clock.seconds : "--"} />
        </div>
        <p className="mt-4 text-sm text-muted">{view ? `Week of ${view.week}` : "Opening the week"}</p>
      </section>
      )}

      <section className="flex flex-col gap-4 border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs tracking-[0.18em] text-muted uppercase">Claim desk</p>
          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
        <p className="text-sm text-muted">1st $200 + T3X. 2nd $50 + T3X. 3rd $10 + T3X. Top 100 get T3X, paid once it is available. 1 T3X for every 2 tags.</p>

        {(!user || mine?.needsX) && (
          <div className="grid gap-3">
            {!proof ? (
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  placeholder="@handle"
                  className="min-h-12 flex-1 border border-line bg-bg px-3 text-fg outline-none"
                />
                <button type="button" disabled={busy} onClick={begin} className="flex min-h-12 items-center justify-center gap-3 bg-fg px-5 text-bg disabled:opacity-50">
                  <XMark />
                  Sign in with X
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted">Post this from @{proof.handle}. The post has to include both tags. A post you already made is fine.</p>
                <p className="border border-line px-3 py-3 font-mono text-sm">{proof.text}</p>
                <a href={proof.intent} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center bg-fg px-5 text-bg">
                  Open X
                </a>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    value={link}
                    onChange={(event) => setLink(event.target.value)}
                    placeholder="https://x.com/name/status/123"
                    className="min-h-12 flex-1 border border-line bg-bg px-3 text-fg outline-none"
                  />
                  <button type="button" disabled={busy} onClick={finish} className="min-h-12 border border-line px-4 text-fg">
                    I posted it
                  </button>
                </div>
                {note ? <p className="text-sm text-gold">{note}</p> : null}
              </>
            )}
          </div>
        )}

        {user && mine && !mine.needsX && (
          <div className="grid gap-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm text-muted">T3X from tags</p>
                <p className="font-mono text-4xl text-gold">{mine.earned ?? mine.balance}</p>
                <p className="mt-1 text-xs text-muted">{mine.tags ?? 0} tags. 1 T3X for every 2 tags.</p>
              </div>
              <button type="button" disabled={busy || !mine.waiting || !mine.address} onClick={claim} className="min-h-12 bg-fg px-5 text-bg disabled:opacity-40">
                Claim {mine.waiting || ""}
              </button>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Wallet address"
                className="min-h-12 flex-1 border border-line bg-bg px-3 font-mono text-sm text-fg outline-none"
              />
              <button type="button" disabled={busy} onClick={saveWallet} className="min-h-12 border border-line px-4 text-fg">
                {mine.address ? "Update wallet" : "Assign wallet"}
              </button>
            </div>
            {!mine.handle ? (
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  placeholder="@handle"
                  className="min-h-12 flex-1 border border-line bg-bg px-3 text-fg outline-none"
                />
                <button type="button" disabled={busy} onClick={saveHandle} className="min-h-12 border border-line px-4 text-fg">
                  Save handle
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                  placeholder={`Link from @${mine.handle}`}
                  className="min-h-12 flex-1 border border-line bg-bg px-3 text-fg outline-none"
                />
                <button type="button" disabled={busy} onClick={scan} className="min-h-12 border border-line px-4 text-fg">
                  Check on X
                </button>
              </div>
            )}
          </div>
        )}

        {note && <p className="text-sm text-gold">{note}</p>}

        <div>
          <h2 className="font-display text-3xl">Board</h2>
          <ol className="mt-3 divide-y divide-line border-t border-line">
            {(view?.board.length ? view.board : [{ handle: "No tags yet", score: 0, prize: "" }]).map((row, index) => (
              <li key={row.handle} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 py-3">
                <span className="font-mono text-sm text-muted">{String(index + 1).padStart(2, "0")}</span>
                <span className="truncate">{row.handle === "No tags yet" ? row.handle : `@${row.handle}`}</span>
                {row.score ? (
                  <span className="col-start-2 font-mono text-sm text-gold">
                    {row.score} tags · {Math.floor(row.score / 2)} T3X
                    {row.prize ? ` · ${row.prize}` : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}

function ClockCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-surface px-3 py-4">
      <p className="font-mono text-4xl text-fg tabular-nums">{value}</p>
      <p className="mt-1 text-xs tracking-[0.16em] text-muted uppercase">{label}</p>
    </div>
  );
}

function XMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M14.7 10.3 22.4 1.5h-2.2l-6.7 7.6L8.2 1.5H1.6l8.1 11.5L1.5 22.5h2.2l7.1-8.1 5.7 8.1h6.6l-8.4-12.2Zm-2.5 2.9-.8-1.2-6.6-9.3h2.8l5.3 7.6.8 1.2 6.9 9.8h-2.8l-5.6-8.1Z" />
    </svg>
  );
}

function parts(ms: number) {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { hours: pad(hours), minutes: pad(minutes), seconds: pad(seconds) };
}
