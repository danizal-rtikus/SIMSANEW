import { useEffect, useState, type CSSProperties } from 'react';

/**
 * Kerangka pemuat yang mengikuti bentuk tata letak asli, agar tidak ada
 * lompatan saat data datang. Muncul setelah jeda singkat sehingga data dari
 * simpanan tampil langsung tanpa kedipan. Animasi denyut, tanpa gradasi.
 */
export type SkeletonVariant = 'block' | 'table' | 'page' | 'detail' | 'editor' | 'cards';

function useDelayed(ms: number) {
  const [show, setShow] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const t = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return show;
}

export function Bar({ w = '100%', h = 12, r, style }: { w?: number | string; h?: number; r?: number; style?: CSSProperties }) {
  return <span className="sk" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

const W = ['92%', '78%', '85%', '64%', '88%', '70%', '81%', '58%'];

function Lines({ n = 4, h = 11 }: { n?: number; h?: number }) {
  return (
    <div className="sk-lines">
      {Array.from({ length: n }, (_, i) => (
        <Bar key={i} w={W[i % W.length]} h={h} />
      ))}
    </div>
  );
}

function Head() {
  return (
    <div className="sk-head">
      <Bar w={260} h={24} />
      <Bar w={420} h={12} style={{ maxWidth: '80%' }} />
    </div>
  );
}

function Table({ rows = 7, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="sk-table">
      <div className="sk-tr head">
        {Array.from({ length: cols }, (_, c) => (
          <Bar key={c} w={c === 0 ? '60%' : '45%'} h={10} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div className="sk-tr" key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <Bar key={c} w={W[(r + c) % W.length]} h={12} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Facts({ n = 4 }: { n?: number }) {
  return (
    <div className="sk-facts">
      {Array.from({ length: n }, (_, i) => (
        <div className="sk-fact" key={i}>
          <Bar w="50%" h={10} />
          <Bar w="35%" h={22} />
        </div>
      ))}
    </div>
  );
}

function Editor() {
  return (
    <div className="sk-ed">
      <div className="sk-outline">
        <Bar w="40%" h={10} />
        {Array.from({ length: 9 }, (_, i) => (
          <Bar key={i} w={i % 3 === 0 ? '80%' : '62%'} h={11} style={{ marginLeft: i % 3 === 0 ? 0 : 12 }} />
        ))}
      </div>
      <div className="sk-paper-col">
        <Bar w="100%" h={40} r={8} />
        <div className="sk-paper">
          <Bar w="30%" h={14} style={{ alignSelf: 'center' }} />
          <Bar w="45%" h={14} style={{ alignSelf: 'center', marginBottom: 18 }} />
          <Bar w="35%" h={12} />
          <Lines n={7} h={10} />
          <Bar w="30%" h={12} style={{ marginTop: 10 }} />
          <Lines n={5} h={10} />
        </div>
      </div>
    </div>
  );
}

export function Skeleton({ variant = 'block', delay = 150, label = 'Memuat' }: { variant?: SkeletonVariant; delay?: number; label?: string }) {
  const show = useDelayed(delay);
  return (
    <div className={`sk-wrap skv-${variant}`} role="status" aria-busy="true" aria-label={label}>
      {show && (
        <>
          {variant === 'block' && (
            <div className="sk-card">
              <Bar w="35%" h={14} />
              <Lines n={4} />
            </div>
          )}
          {variant === 'table' && <Table />}
          {variant === 'cards' && (
            <div className="sk-cards">
              {Array.from({ length: 6 }, (_, i) => (
                <div className="sk-card" key={i}>
                  <Bar w="55%" h={14} />
                  <Lines n={3} />
                </div>
              ))}
            </div>
          )}
          {variant === 'page' && (
            <>
              <Head />
              <Facts />
              <Table rows={6} />
            </>
          )}
          {variant === 'detail' && (
            <>
              <Head />
              <div className="sk-detail">
                <div className="sk-card">
                  <Bar w="30%" h={14} />
                  <Lines n={6} />
                </div>
                <div className="sk-card">
                  <Bar w="45%" h={14} />
                  <Lines n={4} />
                </div>
              </div>
            </>
          )}
          {variant === 'editor' && (
            <>
              <div className="sk-headrow">
                <Bar w={360} h={20} style={{ maxWidth: '60%' }} />
                <Bar w={220} h={34} r={8} />
              </div>
              <Editor />
            </>
          )}
        </>
      )}
    </div>
  );
}
