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
  const [proof, setProof] = useState<{ handle: string; text: string; intent: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

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
      else setProof({ handle: result.handle, text: result.text, intent: result.intent });
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
      const result = await finishProof({ data: link });
      if (!result.ok) setNote(result.error);
      else window.location.assign("/");
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
    <main className="mx-auto grid min-h-dvh w-full max-w-6xl gap-8 px-5 py-8 lg:grid-cols-2 lg:items-center lg:gap-16">
      <section>
        <img src="/brand/t3x-coin.png" alt="" className="h-28 w-28 object-contain sm:h-36 sm:w-36" />
        <p className="mt-6 font-display text-7xl leading-none text-fg sm:text-8xl">T3X</p>
        <p className="mt-3 max-w-sm text-lg text-muted">Sign in with X. Each live tag counts once. The same tag is not counted again.</p>
        <div className="mt-8 grid max-w-md grid-cols-3 gap-3">
          <ClockCell label="Hours" value={view ? clock.hours : "--"} />
          <ClockCell label="Minutes" value={view ? clock.minutes : "--"} />
          <ClockCell label="Seconds" value={view ? clock.seconds : "--"} />
        </div>
        <p className="mt-4 text-sm text-muted">{view ? `Week of ${view.week}` : "Opening the week"}</p>
      </section>

      <section className="flex flex-col gap-5 border border-line bg-surface p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm tracking-[0.18em] text-muted uppercase">Claim desk</p>
          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
        <ul className="grid gap-2 text-sm text-fg sm:grid-cols-3">
          <li className="border border-line px-3 py-3">1st · $200 + T3X</li>
          <li className="border border-line px-3 py-3">2nd · $50 + T3X</li>
          <li className="border border-line px-3 py-3">3rd · $10 + T3X</li>
        </ul>
        <p className="text-sm text-muted">Top 100 get a prize and T3X. T3X will be paid once it becomes available. New tags go out on games and posters. Stay tuned.</p>

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
                <p className="text-sm text-muted">Paste a post from @{proof.handle} that includes both #T3X and #T3XDrop. A post you already made is fine.</p>
                <a href={proof.intent} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center bg-fg px-5 text-bg">
                  Open X
                </a>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    value={link}
                    onChange={(event) => setLink(event.target.value)}
                    placeholder="Link to that post"
                    className="min-h-12 flex-1 border border-line bg-bg px-3 text-fg outline-none"
                  />
                  <button type="button" disabled={busy} onClick={finish} className="min-h-12 border border-line px-4 text-fg">
                    I posted it
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {user && mine && !mine.needsX && (
          <div className="grid gap-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm text-muted">In your wallet</p>
                <p className="font-mono text-5xl text-gold">{mine.balance}</p>
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
              <li key={row.handle} className="flex items-center justify-between py-3">
                <span>
                  <span className="mr-3 font-mono text-sm text-muted">{String(index + 1).padStart(2, "0")}</span>
                  {row.handle === "No tags yet" ? row.handle : `@${row.handle}`}
                </span>
                <span className="font-mono text-gold">{row.score ? `${row.score} · ${row.prize}` : ""}</span>
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
