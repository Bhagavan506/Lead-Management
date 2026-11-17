import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { get } from "../../lib/api";
import { ago, dateTime } from "../../lib/format";
import { useLeadDrawer } from "../../components/useLeadDrawer";
import { Button, Empty, Panel, QueryState } from "../../components/ui";

interface Feed {
  items: {
    id: string;
    text: string;
    createdAt: string;
    actorName: string;
    leadId: string;
    leadName: string;
  }[];
  page: number;
  totalPages: number;
  total: number;
}

export function ActivityPage() {
  const [page, setPage] = useState(1);
  const feed = useQuery({
    queryKey: ["activity", page],
    queryFn: () => get<Feed>(`/api/activity?page=${page}&pageSize=40`),
    placeholderData: keepPreviousData,
  });
  const { open, drawer } = useLeadDrawer();

  return (
    <>
      <QueryState query={feed}>
        {feed.data && feed.data.items.length === 0 ? (
          <Panel>
            <Empty>No activity yet.</Empty>
          </Panel>
        ) : (
          feed.data && (
            <>
              <ul className="rounded-[10px] border border-ln bg-sf">
                {feed.data.items.map((a) => (
                  <li key={a.id} className="border-b border-ln px-3 py-2 last:border-b-0">
                    <button
                      className="tap block w-full cursor-pointer text-left"
                      onClick={() => open(a.leadId)}
                    >
                      <span className="font-bold">{a.leadName}</span> <span>{a.text}</span>
                      <small className="block text-mu" title={dateTime(a.createdAt)}>
                        {a.actorName} · {ago(a.createdAt)}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-center gap-3">
                <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Newer
                </Button>
                <span className="text-mu">
                  Page {feed.data.page} of {feed.data.totalPages}
                </span>
                <Button disabled={page >= feed.data.totalPages} onClick={() => setPage(page + 1)}>
                  Older
                </Button>
              </div>
            </>
          )
        )}
      </QueryState>
      {drawer}
    </>
  );
}
