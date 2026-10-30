// The server branches with their verdict re-applied for the current inactivity threshold. Plain, without
// runes: the store's derived hands it the lists and gets a list back that keeps its identity while nothing
// changed.
import type { RemoteBranchReport } from "./bindings/RemoteBranchReport";
import { classifyOnline } from "./filter";

interface Memo {
  list: RemoteBranchReport[] | null;
  /** Source object → the object handed out for it. */
  from: Map<RemoteBranchReport, RemoteBranchReport>;
}
const EMPTY: Memo = { list: null, from: new Map() };

/**
 * The clock ticks every 30 s: an unchanged verdict keeps its object, and an unchanged list keeps its
 * identity, so the table is not rebuilt (and does not jump) for nothing. A changed branch is a new source
 * object (the store replaces results, never writes into them), so identity is enough to know it.
 */
export class OnlineReclassifier {
  private memo: Memo = EMPTY;

  /** null while no list is there, or no threshold known yet. */
  run(lists: RemoteBranchReport[][], now: number, staleDays: number | undefined): RemoteBranchReport[] | null {
    if (staleDays === undefined || !lists.length) {
      this.memo = EMPTY;
      return null;
    }
    const prev = this.memo;
    const from = new Map<RemoteBranchReport, RemoteBranchReport>();
    let same = prev.list !== null;
    const list = lists.flat().map((b, i) => {
      const verdict = classifyOnline(b.merged, b.openPr, now - b.lastCommitAt, staleDays);
      const hit = prev.from.get(b);
      const out = hit && hit.verdict === verdict ? hit : { ...b, verdict };
      from.set(b, out);
      if (prev.list?.[i] !== out) same = false;
      return out;
    });
    same &&= prev.list!.length === list.length;
    this.memo = { list: same ? prev.list : list, from };
    return this.memo.list;
  }
}
