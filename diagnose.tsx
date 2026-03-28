import {
  AVPlayer,
  BackgroundURLSession,
  Button,
  Form,
  Intent,
  MediaPlayer,
  Navigation,
  Script,
  Section,
  SharedAudioSession,
  Storage,
  Text,
  VStack,
} from "scripting";

type RuntimeCheck = [string, () => string];
const globalRuntime = globalThis as any;

const runtimeChecks: RuntimeCheck[] = [
  ["Script.env", () => String(Script?.env)],
  ["typeof imported AVPlayer", () => typeof AVPlayer],
  ["typeof global AVPlayer", () => typeof globalRuntime.AVPlayer],
  ["typeof imported SharedAudioSession", () => typeof SharedAudioSession],
  ["typeof global SharedAudioSession", () => typeof globalRuntime.SharedAudioSession],
  ["typeof imported MediaPlayer", () => typeof MediaPlayer],
  ["typeof global MediaPlayer", () => typeof globalRuntime.MediaPlayer],
  ["typeof imported BackgroundURLSession", () => typeof BackgroundURLSession],
  ["typeof global BackgroundURLSession", () => typeof globalRuntime.BackgroundURLSession],
  ["typeof imported Storage", () => typeof Storage],
  ["typeof global Storage", () => typeof globalRuntime.Storage],
  ["typeof imported Intent", () => typeof Intent],
];

function collectChecks() {
  return runtimeChecks.map(([label, getter]) => {
    try {
      return {
        label,
        value: getter(),
      };
    } catch (error) {
      return {
        label,
        value: `threw: ${String(error)}`,
      };
    }
  });
}

function DiagnoseApp() {
  const checks = collectChecks();
  const avPlayerType =
    checks.find((item) => item.label === "typeof imported AVPlayer")?.value === "function" ||
    checks.find((item) => item.label === "typeof global AVPlayer")?.value === "function"
      ? "function"
      : "missing";
  const canConstructPlayer = avPlayerType === "function";

  return (
    <Form formStyle="grouped">
      <Section
        header={<Text>运行时诊断</Text>}
        footer={
          <VStack alignment="leading">
            <Text>这个页面不会创建播放器实例，只检查当前 Scripting 运行时暴露了哪些 API。</Text>
            <Text>如果 imported 版本是 `undefined`，但 global 版本是 `function`，说明音频 API 更像文档示例里那样是全局对象。</Text>
          </VStack>
        }
      >
        {checks.map((item) => (
          <Text key={item.label}>{item.label}: {item.value}</Text>
        ))}
      </Section>

      <Section header={<Text>结论</Text>}>
        <Text>
          {canConstructPlayer
            ? "当前环境看起来支持 AVPlayer，可以继续回去测播放器逻辑。"
            : "当前环境没有可用的 AVPlayer 构造器。请先检查 Scripting 版本，或确认你是不是在支持音频 API 的运行模式里。"}
        </Text>
      </Section>

      <Section header={<Text>下一步</Text>}>
        <Button
          title="关闭"
          action={() => {
            Script.exit();
          }}
        />
      </Section>
    </Form>
  );
}

async function run() {
  await Navigation.present({
    element: <DiagnoseApp />,
  });

  Script.exit();
}

void run();
