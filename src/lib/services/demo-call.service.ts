import {
  Transcript,
  UltravoxSession,
  UltravoxSessionStatus,
} from "ultravox-client";

export type DemoCallStatus = `${UltravoxSessionStatus}`;

export type DemoTranscriptItem = {
  ordinal: number;
  text: string;
  speaker: string;
  isFinal: boolean;
  medium: string;
};

type DemoCallServiceOptions = {
  onStatusChange?: (status: DemoCallStatus) => void;
  onTranscriptsChange?: (transcripts: DemoTranscriptItem[]) => void;
};

export class DemoCallService {
  private session: UltravoxSession | null = null;
  private readonly onStatusChange?: (status: DemoCallStatus) => void;
  private readonly onTranscriptsChange?: (transcripts: DemoTranscriptItem[]) => void;
  private readonly handleStatus = () => {
    if (!this.session) return;
    this.onStatusChange?.(this.session.status);
  };
  private readonly handleTranscripts = () => {
    if (!this.session) return;
    this.onTranscriptsChange?.(this.serializeTranscripts(this.session.transcripts));
  };

  constructor(options: DemoCallServiceOptions = {}) {
    this.onStatusChange = options.onStatusChange;
    this.onTranscriptsChange = options.onTranscriptsChange;
  }

  join(joinUrl: string) {
    if (this.session) {
      throw new Error("A demo call is already active");
    }

    const session = new UltravoxSession();
    session.addEventListener("status", this.handleStatus);
    session.addEventListener("transcripts", this.handleTranscripts);
    this.session = session;
    this.onStatusChange?.(session.status);
    session.joinCall(joinUrl);
  }

  async leave() {
    if (!this.session) return;
    const session = this.session;
    this.session = null;
    session.removeEventListener("status", this.handleStatus);
    session.removeEventListener("transcripts", this.handleTranscripts);
    await session.leaveCall();
    this.onStatusChange?.(UltravoxSessionStatus.DISCONNECTED);
    this.onTranscriptsChange?.(this.serializeTranscripts(session.transcripts));
  }

  toggleMic() {
    if (!this.session) return;
    this.session.toggleMicMute();
  }

  toggleSpeaker() {
    if (!this.session) return;
    this.session.toggleSpeakerMute();
  }

  getStatus(): DemoCallStatus {
    return this.session?.status ?? UltravoxSessionStatus.DISCONNECTED;
  }

  getTranscripts(): DemoTranscriptItem[] {
    return this.session ? this.serializeTranscripts(this.session.transcripts) : [];
  }

  get isMicMuted() {
    return this.session?.isMicMuted ?? false;
  }

  get isSpeakerMuted() {
    return this.session?.isSpeakerMuted ?? false;
  }

  private serializeTranscripts(transcripts: Transcript[]): DemoTranscriptItem[] {
    return transcripts.map((item) => ({
      ordinal: item.ordinal,
      text: item.text,
      speaker: item.speaker,
      isFinal: item.isFinal,
      medium: item.medium,
    }));
  }
}
