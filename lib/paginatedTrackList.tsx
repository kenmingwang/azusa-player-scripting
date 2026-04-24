import {
  Button,
  ForEach,
  HStack,
  LazyVStack,
  Spacer,
  Text,
  TextField,
  VStack,
  useEffect,
  useMemo,
  useObservable,
  useState,
} from "scripting";

import {
  DEFAULT_QUEUE_PAGE_SIZE,
  buildPaginatedTrackState,
  clampPage,
  pageForTrackIndex,
  type PaginatedTrackRow,
} from "./paginatedTracks";
import type { Track } from "./types";

type PaginatedTrackListProps = {
  tracks: Track[];
  currentIndex: number;
  pageSize?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  followCurrentTrack?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  noResultsTitle?: string;
  noResultsMessage?: string;
  renderRow: (row: PaginatedTrackRow) => any;
};

const ForEachApi = ForEach as any;
const useObservableApi = useObservable as any;

function parsePageInput(value: string) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

export function PaginatedTrackList(props: PaginatedTrackListProps) {
  const pageSize = props.pageSize ?? DEFAULT_QUEUE_PAGE_SIZE;
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(
    props.followCurrentTrack
      ? pageForTrackIndex(props.currentIndex, pageSize)
      : 1,
  );
  const [pageInput, setPageInput] = useState(String(page));
  const pageState = useMemo(
    () =>
      buildPaginatedTrackState({
        tracks: props.tracks,
        query,
        page,
        pageSize,
        currentIndex: props.currentIndex,
      }),
    [props.tracks, query, page, pageSize, props.currentIndex],
  );
  const rowObservable =
    typeof useObservableApi === "function"
      ? useObservableApi(() => pageState.rows)
      : null;

  useEffect(() => {
    setPage(1);
  }, [query, props.tracks]);

  useEffect(() => {
    const nextPage = clampPage(page, pageState.totalPages);
    if (nextPage !== page) {
      setPage(nextPage);
    }
  }, [page, pageState.totalPages]);

  useEffect(() => {
    if (!props.followCurrentTrack || query.trim() || props.currentIndex < 0) {
      return;
    }

    setPage(pageForTrackIndex(props.currentIndex, pageSize));
  }, [props.followCurrentTrack, props.currentIndex, query, pageSize]);

  useEffect(() => {
    setPageInput(String(pageState.page));
  }, [pageState.page]);

  useEffect(() => {
    rowObservable?.setValue?.(pageState.rows);
  }, [rowObservable, pageState.rows]);

  function jumpToPage(nextPage: number) {
    setPage(clampPage(nextPage, pageState.totalPages));
  }

  const hasTracks = props.tracks.length > 0;
  const hasResults = pageState.resultCount > 0;

  return (
    <VStack alignment={"leading"} spacing={12}>
      {props.searchable ? (
        <TextField
          title="Search"
          placeholder={props.searchPlaceholder ?? "Title / artist / CID"}
          value={query}
          onChanged={setQuery}
        />
      ) : null}

      <HStack spacing={8}>
        <Text font={"caption"} foregroundColor={"secondary"}>
          {hasResults
            ? `${pageState.startResult}-${pageState.endResult} / ${pageState.resultCount}`
            : `0 / ${pageState.resultCount}`}
          {pageState.resultCount !== pageState.totalCount
            ? ` · total ${pageState.totalCount}`
            : ""}
        </Text>
        <Spacer />
        <Text font={"caption"} foregroundColor={"secondary"}>
          Page {pageState.page}/{pageState.totalPages}
        </Text>
      </HStack>

      <HStack spacing={8}>
        <Button
          title="Prev"
          buttonStyle="bordered"
          action={() => jumpToPage(pageState.page - 1)}
        />
        <Button
          title="Next"
          buttonStyle="bordered"
          action={() => jumpToPage(pageState.page + 1)}
        />
        <TextField
          title="Jump"
          placeholder="Page"
          value={pageInput}
          onChanged={setPageInput}
        />
        <Button
          title="Go"
          buttonStyle="bordered"
          action={() => jumpToPage(parsePageInput(pageInput))}
        />
      </HStack>

      {!hasTracks ? (
        <VStack alignment={"leading"} spacing={4}>
          <Text font={"headline"}>{props.emptyTitle ?? "No tracks yet"}</Text>
          <Text font={"subheadline"} foregroundColor={"secondary"}>
            {props.emptyMessage ?? "Import a source before opening the queue."}
          </Text>
        </VStack>
      ) : !hasResults ? (
        <VStack alignment={"leading"} spacing={4}>
          <Text font={"headline"}>{props.noResultsTitle ?? "No matches"}</Text>
          <Text font={"subheadline"} foregroundColor={"secondary"}>
            {props.noResultsMessage ?? "Try another search term."}
          </Text>
        </VStack>
      ) : (
        <LazyVStack alignment={"leading"} spacing={12}>
          {rowObservable && typeof ForEachApi === "function" ? (
            <ForEachApi
              data={rowObservable}
              builder={(row: PaginatedTrackRow) => props.renderRow(row)}
            />
          ) : (
            pageState.rows.map((row) => props.renderRow(row))
          )}
        </LazyVStack>
      )}
    </VStack>
  );
}
