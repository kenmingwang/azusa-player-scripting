import {
  Button,
  HStack,
  List,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  useEffect,
  useState,
} from "scripting";

import {
  sourceKindLabel,
  sourceSecondaryLabel,
  sourceShortLabel,
} from "./sources";
import type { SourceDescriptor } from "./types";

type SourceLibraryPageProps = {
  activeSource: SourceDescriptor;
  recentSources: SourceDescriptor[];
  loading: boolean;
  errorMessage?: string | null;
  onSearchInput: (input: string) => Promise<void>;
  onPromptSource: (kind: SourceDescriptor["kind"]) => Promise<void>;
  onLoadSource: (source: SourceDescriptor) => Promise<void>;
  onLoadDefault: () => Promise<void>;
  onReload: () => Promise<void>;
};

export function SourceLibraryPage(props: SourceLibraryPageProps) {
  const [query, setQuery] = useState(props.activeSource.input);

  useEffect(() => {
    setQuery(props.activeSource.input);
  }, [props.activeSource.input]);

  return (
    <List
      navigationTitle={"歌单来源"}
      navigationBarTitleDisplayMode={"inline"}
      listStyle={"plain"}
    >
      <Section header={<Text font={"caption"}>当前来源</Text>}>
        <VStack alignment={"leading"} spacing={4}>
          <Text font={"headline"}>{sourceShortLabel(props.activeSource)}</Text>
          <Text font={"subheadline"} foregroundColor={"secondary"}>
            {sourceKindLabel(props.activeSource.kind)} · {sourceSecondaryLabel(props.activeSource)}
          </Text>
        </VStack>
        <Button
          title={props.loading ? "刷新中..." : "重新拉取"}
          buttonStyle="bordered"
          action={() => void props.onReload()}
        />
      </Section>

      <Section header={<Text font={"caption"}>搜索并导入</Text>}>
        <VStack alignment={"leading"} spacing={10}>
          <TextField
            title="来源输入"
            placeholder="BV / 视频链接 / 收藏夹 / 合集 / 频道"
            value={query}
            onChanged={setQuery}
          />
          <Text font={"caption"} foregroundColor={"secondary"}>
            支持 BV、视频链接、favorite:mediaId、收藏夹链接、season / series 链接、channel / UP 主页链接。
          </Text>
          <Button
            title={props.loading ? "导入中..." : "打开这个来源"}
            buttonStyle="borderedProminent"
            action={() => void props.onSearchInput(query)}
          />
          {props.errorMessage ? (
            <Text font={"caption"} foregroundColor={"systemRed"}>
              {props.errorMessage}
            </Text>
          ) : null}
        </VStack>
      </Section>

      <Section header={<Text font={"caption"}>辅助入口</Text>}>
        <Button title="填入视频示例" action={() => setQuery("BV1wr4y1v7TA")} />
        <Button title="填入收藏夹前缀" action={() => setQuery("favorite:")} />
        <Button title="填入合集前缀" action={() => setQuery("season:")} />
        <Button title="填入频道前缀" action={() => setQuery("channel:")} />
        <Button title="切回默认歌单" action={() => void props.onLoadDefault()} />
      </Section>

      {props.recentSources.length > 0 ? (
        <Section header={<Text font={"caption"}>最近来源</Text>}>
          {props.recentSources.map((source) => (
            <Button
              action={() => void props.onLoadSource(source)}
              key={source.input}>
              <HStack spacing={12}>
                <VStack alignment={"leading"} spacing={3}>
                  <Text font={"body"}>{sourceShortLabel(source)}</Text>
                  <Text font={"caption"} foregroundColor={"secondary"}>
                    {sourceKindLabel(source.kind)} · {sourceSecondaryLabel(source)}
                  </Text>
                </VStack>
                <Spacer />
                <Text font={"caption"} foregroundColor={"systemBlue"}>
                  打开
                </Text>
              </HStack>
            </Button>
          ))}
        </Section>
      ) : null}
    </List>
  );
}
