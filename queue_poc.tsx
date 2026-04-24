import {
  Button,
  HStack,
  LazyVStack,
  Navigation,
  NavigationStack,
  Script,
  ScrollView,
  Spacer,
  Text,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting";

import { activeLyricLineIndex, parseLyrics } from "./lib/lyrics";
import { PaginatedTrackList } from "./lib/paginatedTrackList";
import type { Track } from "./lib/types";

const MOCK_TRACK_COUNT = 1000;

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function createMockTracks() {
  return Array.from({ length: MOCK_TRACK_COUNT }, (_, index): Track => {
    const displayIndex = index + 1;
    return {
      id: `mock-track-${displayIndex}`,
      bvid: `BVPOC${String(displayIndex).padStart(4, "0")}`,
      cid: String(900000 + displayIndex),
      title: `POC Track ${String(displayIndex).padStart(4, "0")}`,
      artist: `Artist ${(index % 24) + 1}`,
      sourceTitle: "1000 Track Queue POC",
      durationSeconds: 150 + (index % 120),
    };
  });
}

function createMockLyrics() {
  return Array.from({ length: 90 }, (_, index) => {
    const timestamp = formatTime(index * 2);
    return `[${timestamp}.00]POC lyric line ${index + 1}`;
  }).join("\n");
}

function QueuePocApp() {
  const tracks = useMemo(() => createMockTracks(), []);
  const parsedLyrics = useMemo(() => parseLyrics(createMockLyrics()), []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playbackTime, setPlaybackTime] = useState(0);
  const currentTrack = tracks[currentIndex] ?? null;
  const activeLyricIndex = useMemo(
    () => activeLyricLineIndex(parsedLyrics, playbackTime),
    [parsedLyrics, playbackTime],
  );
  const lyricAnchor = activeLyricIndex >= 0 ? activeLyricIndex : 0;
  const lyricSlots = useMemo(
    () =>
      [-2, -1, 0, 1, 2].map((offset) => {
        const index = lyricAnchor + offset;
        return {
          id: `lyric-${offset}`,
          offset,
          line:
            index >= 0 && index < parsedLyrics.lines.length
              ? parsedLyrics.lines[index]
              : null,
        };
      }),
    [lyricAnchor, parsedLyrics.lines],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setPlaybackTime((current) => (current + 1) % 180);
    }, 500);

    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setPlaybackTime(0);
  }, [currentIndex]);

  return (
    <NavigationStack>
      <ScrollView
        navigationTitle={"Queue POC"}
        navigationBarTitleDisplayMode={"large"}>
        <LazyVStack
          alignment={"leading"}
          spacing={24}
          padding={{ horizontal: 16, vertical: 16 }}>
          <VStack alignment={"leading"} spacing={8}>
            <Text font={"title3"}>1000 track pagination POC</Text>
            <Text font={"caption"} foregroundColor={"secondary"}>
              The queue renders 50 rows per page, searches all 1000 rows, and
              keeps a live lyric window ticking independently.
            </Text>
            <Text font={"caption"} foregroundColor={"secondary"}>
              Current: {currentIndex + 1}/{tracks.length} ·{" "}
              {currentTrack?.title ?? "None"} · {formatTime(playbackTime)}
            </Text>
          </VStack>

          <VStack alignment={"leading"} spacing={12}>
            <Text font={"caption"} foregroundColor={"secondary"}>
              Lyric window
            </Text>
            {lyricSlots.map(({ id, offset, line }) => {
              const isActive = offset === 0 && activeLyricIndex >= 0;
              return (
                <Text
                  key={id}
                  font={isActive ? "title2" : "body"}
                  foregroundColor={isActive ? "systemBlue" : "secondary"}
                  multilineTextAlignment={"center"}>
                  {line?.text ?? " "}
                </Text>
              );
            })}
          </VStack>

          <PaginatedTrackList
            tracks={tracks}
            currentIndex={currentIndex}
            searchable
            followCurrentTrack
            searchPlaceholder="Title / artist / CID / BV"
            renderRow={(row) => (
              <Button
                key={row.id}
                action={() => {
                  setCurrentIndex(row.index);
                }}>
                <HStack spacing={12}>
                  <VStack alignment={"leading"} spacing={4}>
                    <Text font={row.isActive ? "headline" : "body"}>
                      {row.displayIndex}. {row.track.title}
                    </Text>
                    <Text font={"caption"} foregroundColor={"secondary"}>
                      {row.track.artist} · CID {row.track.cid}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Text
                    font={"caption"}
                    foregroundColor={row.isActive ? "systemBlue" : "secondary"}>
                    {row.isActive ? "Playing" : "Play"}
                  </Text>
                </HStack>
              </Button>
            )}
          />
        </LazyVStack>
      </ScrollView>
    </NavigationStack>
  );
}

async function run() {
  await Navigation.present({
    element: <QueuePocApp />,
  });

  Script.exit();
}

void run();
