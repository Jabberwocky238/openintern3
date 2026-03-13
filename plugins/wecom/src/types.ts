export interface WecomConfig {
  enabled: boolean;
  botId: string;
  secret: string;
  websocketUrl: string;
  allowFrom: string[];
  groupAllowFrom: string[];
  mediaDir: string;
}

export interface WecomInboundMessage {
  id: string;
  senderId: string;
  chatId: string;
  content: string;
  timestamp: string;
  msgType: string;
  event?: string;
  media: string[];
  metadata: Record<string, unknown>;
}

export interface WecomEngineStatus {
  enabled: boolean;
  started: boolean;
  connected: boolean;
  authenticated: boolean;
  websocketUrl: string;
  botId: string;
  mediaDir: string;
  queueSize: number;
  allowFrom: string[];
  groupAllowFrom: string[];
  reconnectAttempts: number;
  lastError: string | null;
}

export interface WecomTextPart {
  content?: string;
}

export interface WecomMediaPart {
  url?: string;
  aeskey?: string;
}

export interface WecomMixedItem {
  msgtype: "text" | "image";
  text?: WecomTextPart;
  image?: WecomMediaPart;
}

export interface WecomQuote {
  msgtype: string;
  text?: WecomTextPart;
  voice?: WecomTextPart;
  image?: WecomMediaPart;
  file?: WecomMediaPart;
}

export interface WecomMessageBody {
  msgid: string;
  aibotid?: string;
  chatid?: string;
  chattype: "single" | "group";
  from: {
    userid: string;
  };
  create_time?: number;
  response_url?: string;
  msgtype: string;
  text?: WecomTextPart;
  image?: WecomMediaPart;
  voice?: WecomTextPart;
  mixed?: {
    msg_item: WecomMixedItem[];
  };
  file?: WecomMediaPart;
  quote?: WecomQuote;
}
