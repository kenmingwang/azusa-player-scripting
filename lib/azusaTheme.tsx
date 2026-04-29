import {
  Button,
  HStack,
  Image,
  LazyVStack,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from "scripting";

type GlassTone = "base" | "accent" | "strong" | "soft" | "danger";

export function azusaGlassBackground(tone: GlassTone = "base", cornerRadius = 24) {
  const styles = {
    base: {
      light: "rgba(255, 255, 255, 0.78)",
      dark: "rgba(33, 28, 48, 0.86)",
    },
    accent: {
      light: "rgba(245, 239, 255, 0.92)",
      dark: "rgba(82, 62, 125, 0.34)",
    },
    strong: {
      light: "rgba(255, 255, 255, 0.94)",
      dark: "rgba(25, 22, 35, 0.96)",
    },
    soft: {
      light: "rgba(249, 246, 255, 0.68)",
      dark: "rgba(255, 255, 255, 0.07)",
    },
    danger: {
      light: "rgba(255, 241, 242, 0.88)",
      dark: "rgba(127, 29, 29, 0.24)",
    },
  } satisfies Record<GlassTone, { light: string; dark: string }>;

  return {
    style: styles[tone],
    shape: {
      type: "rect",
      cornerRadius,
      style: "continuous",
    },
  };
}

export function azusaPageBackground() {
  return {
    style: {
      light: "rgba(250, 247, 255, 1)",
      dark: "rgba(17, 15, 25, 1)",
    },
  };
}

export function AzusaPage(props: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  children?: any;
  scrollDismissesKeyboard?: string;
}) {
  return (
    <ScrollView
      navigationTitle={props.title}
      navigationBarTitleDisplayMode={"inline"}
      scrollDismissesKeyboard={props.scrollDismissesKeyboard}
      background={azusaPageBackground()}>
      <LazyVStack
        alignment={"leading"}
        spacing={18}
        padding={{ horizontal: 16, vertical: 16 }}>
        <AzusaHeader
          eyebrow={props.eyebrow}
          title={props.title}
          subtitle={props.subtitle}
        />
        {props.children}
        <VStack spacing={1} />
      </LazyVStack>
    </ScrollView>
  );
}

export function AzusaHeader(props: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  trailing?: any;
}) {
  return (
    <HStack spacing={12}>
      <VStack alignment={"leading"} spacing={5}>
        {props.eyebrow ? (
          <Text font={"caption"} foregroundColor={"secondary"}>
            {props.eyebrow}
          </Text>
        ) : null}
        <Text font={"title2"}>{props.title}</Text>
        {props.subtitle ? (
          <Text font={"caption"} foregroundColor={"secondary"}>
            {props.subtitle}
          </Text>
        ) : null}
      </VStack>
      <Spacer />
      {props.trailing ?? null}
    </HStack>
  );
}

export function GlassPanel(props: {
  children?: any;
  tone?: GlassTone;
  compact?: boolean;
}) {
  return (
    <VStack
      alignment={"leading"}
      spacing={props.compact ? 10 : 14}
      padding={{
        horizontal: props.compact ? 12 : 16,
        vertical: props.compact ? 12 : 16,
      }}
      background={azusaGlassBackground(props.tone ?? "base", props.compact ? 18 : 24)}>
      {props.children}
    </VStack>
  );
}

export function IconLabel(props: {
  systemName: string;
  title: string;
  subtitle?: string;
  active?: boolean;
}) {
  return (
    <HStack spacing={10}>
      <Image
        systemName={props.systemName}
        resizable
        aspectRatio={{ contentMode: "fit" }}
        frame={{ width: 20, height: 20 }}
        foregroundColor={props.active ? "systemBlue" : "secondary"}
      />
      <VStack alignment={"leading"} spacing={3}>
        <Text font={"body"} foregroundColor={props.active ? "systemBlue" : "primary"}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text font={"caption"} foregroundColor={"secondary"}>
            {props.subtitle}
          </Text>
        ) : null}
      </VStack>
    </HStack>
  );
}

export function IconPillButton(props: {
  title: string;
  systemName?: string;
  prominent?: boolean;
  action: () => void | Promise<void>;
}) {
  return (
    <Button
      buttonStyle={props.prominent ? "borderedProminent" : "bordered"}
      action={() => void props.action()}>
      <HStack spacing={8} padding={{ horizontal: 8, vertical: 4 }}>
        {props.systemName ? (
          <Image
            systemName={props.systemName}
            resizable
            aspectRatio={{ contentMode: "fit" }}
            frame={{ width: 15, height: 15 }}
          />
        ) : null}
        <Text font={"subheadline"}>{props.title}</Text>
      </HStack>
    </Button>
  );
}

export function StatusChip(props: {
  title: string;
  tone?: "default" | "blue" | "orange" | "red";
}) {
  const color =
    props.tone === "red"
      ? "systemRed"
      : props.tone === "orange"
        ? "systemOrange"
        : props.tone === "blue"
          ? "systemBlue"
          : "secondary";

  return (
    <HStack
      spacing={6}
      padding={{ horizontal: 10, vertical: 6 }}
      background={azusaGlassBackground(props.tone === "red" ? "danger" : "soft", 16)}>
      <Text font={"caption"} foregroundColor={color}>
        {props.title}
      </Text>
    </HStack>
  );
}
