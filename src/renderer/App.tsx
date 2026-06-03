import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  FileJson,
  FolderOpen,
  ImagePlus,
  Layers,
  Loader2,
  Palette,
  Save,
  Settings2,
  Sparkles,
  Terminal
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  AGENT_PROVIDER_IDS,
  ANIMATION_MODES,
  SEGMENTATION_MODES,
  STYLE_PRESETS,
  type AgentProviderId,
  type AnimationMode,
  type PixelRequest,
  type SegmentationMode,
  type StylePreset
} from '../core/types';
import {
  agentProviderLabels,
  animationModeLabels,
  segmentationModeLabels,
  stylePresetLabels,
  type AppSettings,
  type PipelineResultView
} from '../shared/api';

const SIZE_PRESETS = [16, 32, 64, 128] as const;

export function App(): ReactElement {
  const [settings, setSettings] = useState<AppSettings>({
    agentProvider: 'local',
    asepritePath: '',
    cliCommand: 'codex exec --skip-git-repo-check --ephemeral --ignore-rules --sandbox read-only --image "{imagePath}" -',
    openAiApiKey: '',
    openAiBaseUrl: 'https://api.openai.com/v1',
    openAiModel: 'gpt-4.1',
    outputRoot: ''
  });
  const [imagePath, setImagePath] = useState('');
  const [targetWidth, setTargetWidth] = useState(32);
  const [targetHeight, setTargetHeight] = useState(32);
  const [paletteMax, setPaletteMax] = useState(16);
  const [stylePreset, setStylePreset] = useState<StylePreset>('rpg-item');
  const [segmentationMode, setSegmentationMode] = useState<SegmentationMode>('none');
  const [animationMode, setAnimationMode] = useState<AnimationMode>('single');
  const [outputName, setOutputName] = useState('sprite');
  const [result, setResult] = useState<PipelineResultView | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.asepilot
      .getSettings()
      .then(setSettings)
      .catch((unknownError: unknown) => {
        setError(getErrorMessage(unknownError));
      });
  }, []);

  const semanticTopdownRequested = requiresAiTopdown(stylePreset, animationMode);
  const localSemanticTopdownBlocked = settings.agentProvider === 'local' && semanticTopdownRequested;
  const canGenerate = imagePath.trim().length > 0 && outputName.trim().length > 0 && !isRunning && !localSemanticTopdownBlocked;
  const asepriteStatus = useMemo(() => {
    if (!result) return null;
    if (result.aseprite.status === 'success') return 'Aseprite export finished';
    if (result.aseprite.status === 'skipped') return 'Aseprite export skipped';
    return 'Aseprite export failed';
  }, [result]);

  async function handleSelectImage(): Promise<void> {
    const selected = await window.asepilot.selectImage();
    if (!selected) return;

    setImagePath(selected);
    setOutputName(toOutputName(selected));
    setResult(null);
    setError(null);
  }

  async function handleSelectAseprite(): Promise<void> {
    const selected = await window.asepilot.selectAseprite();
    if (!selected) return;

    const nextSettings = await window.asepilot.saveSettings({
      ...settings,
      asepritePath: selected
    });
    setSettings(nextSettings);
  }

  async function handleSelectOutputFolder(): Promise<void> {
    const selected = await window.asepilot.selectOutputFolder();
    if (!selected) return;

    const nextSettings = await window.asepilot.saveSettings({
      ...settings,
      outputRoot: selected
    });
    setSettings(nextSettings);
  }

  async function handleSaveSettings(): Promise<void> {
    setIsSavingSettings(true);
    setError(null);

    try {
      const nextSettings = await window.asepilot.saveSettings(settings);
      setSettings(nextSettings);
    } catch (unknownError) {
      setError(getErrorMessage(unknownError));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleGenerate(): Promise<void> {
    if (localSemanticTopdownBlocked) {
      setError('Top-down 4 huong/walk can AI provider de ve lai huong trai/phai/up. Local chi co the rotate/transform anh goc.');
      return;
    }

    const request: PixelRequest = {
      imagePath,
      targetWidth,
      targetHeight,
      paletteMax,
      stylePreset,
      segmentationMode,
      animationMode,
      outputName
    };

    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const savedSettings = await window.asepilot.saveSettings(settings);
      setSettings(savedSettings);
      const nextResult = await window.asepilot.runPipeline(request);
      setResult(nextResult);
    } catch (unknownError) {
      setError(getErrorMessage(unknownError));
    } finally {
      setIsRunning(false);
    }
  }

  function setSquareSize(size: number): void {
    setTargetWidth(size);
    setTargetHeight(size);
  }

  function setAgentProvider(provider: AgentProviderId): void {
    setSettings({
      ...settings,
      agentProvider: provider
    });

    if (provider === 'local' && segmentationMode === 'ai-model') {
      setSegmentationMode('auto-local');
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>AsePilot</h1>
          <p>Reference image to validated pixel plan, Lua script, and Aseprite export.</p>
        </div>
        <button className="primary-action" disabled={!canGenerate} onClick={() => void handleGenerate()}>
          {isRunning ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
          Generate
        </button>
      </header>

      <section className="workspace-grid">
        <div className="panel controls-panel">
          <section className="control-section">
            <div className="section-title">
              <ImagePlus size={18} />
              <h2>Reference</h2>
            </div>
            <button className="secondary-action" onClick={() => void handleSelectImage()}>
              <FolderOpen size={17} />
              Select Image
            </button>
            <PathLine value={imagePath || 'No image selected'} />
          </section>

          <section className="control-section">
            <div className="section-title">
              <Palette size={18} />
              <h2>Canvas</h2>
            </div>
            <div className="segmented">
              {SIZE_PRESETS.map((size) => (
                <button
                  className={targetWidth === size && targetHeight === size ? 'selected' : ''}
                  key={size}
                  onClick={() => setSquareSize(size)}
                  type="button"
                >
                  {size}
                </button>
              ))}
            </div>
            <div className="input-grid">
              <label>
                Width
                <input
                  max={256}
                  min={1}
                  onChange={(event) => setTargetWidth(toInteger(event.target.value, 32))}
                  type="number"
                  value={targetWidth}
                />
              </label>
              <label>
                Height
                <input
                  max={256}
                  min={1}
                  onChange={(event) => setTargetHeight(toInteger(event.target.value, 32))}
                  type="number"
                  value={targetHeight}
                />
              </label>
              <label>
                Colors
                <input
                  max={64}
                  min={2}
                  onChange={(event) => setPaletteMax(toInteger(event.target.value, 16))}
                  type="number"
                  value={paletteMax}
                />
              </label>
            </div>
          </section>

          <section className="control-section">
            <div className="section-title">
              <Settings2 size={18} />
              <h2>Style</h2>
            </div>
            <select onChange={(event) => setStylePreset(event.target.value as StylePreset)} value={stylePreset}>
              {STYLE_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {stylePresetLabels[preset]}
                </option>
              ))}
            </select>
            <label>
              Animation
              <select onChange={(event) => setAnimationMode(event.target.value as AnimationMode)} value={animationMode}>
                {ANIMATION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {animationModeLabels[mode]}
                  </option>
                ))}
              </select>
            </label>
            {localSemanticTopdownBlocked ? (
              <div className="hint-box warning">
                <AlertTriangle size={17} />
                <span>Top-down semantic can AI provider. Local chi rotate/transform, khong ve lai mat trai/phai/up.</span>
              </div>
            ) : null}
            <label>
              Output
              <input onChange={(event) => setOutputName(event.target.value)} type="text" value={outputName} />
            </label>
          </section>

          <section className="control-section">
            <div className="section-title">
              <Layers size={18} />
              <h2>Layer Split</h2>
            </div>
            <select onChange={(event) => setSegmentationMode(event.target.value as SegmentationMode)} value={segmentationMode}>
              {SEGMENTATION_MODES.map((mode) => (
                <option disabled={mode === 'ai-model' && settings.agentProvider === 'local'} key={mode} value={mode}>
                  {segmentationModeLabels[mode]}
                </option>
              ))}
            </select>
          </section>

          <section className="control-section">
            <div className="section-title">
              <Bot size={18} />
              <h2>Agent</h2>
            </div>
            <select onChange={(event) => setAgentProvider(event.target.value as AgentProviderId)} value={settings.agentProvider}>
              {AGENT_PROVIDER_IDS.map((provider) => (
                <option key={provider} value={provider}>
                  {agentProviderLabels[provider]}
                </option>
              ))}
            </select>
            {settings.agentProvider === 'openai-compatible' ? (
              <>
                <label>
                  Model
                  <input
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        openAiModel: event.target.value
                      })
                    }
                    type="text"
                    value={settings.openAiModel}
                  />
                </label>
                <label>
                  Base URL
                  <input
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        openAiBaseUrl: event.target.value
                      })
                    }
                    type="text"
                    value={settings.openAiBaseUrl}
                  />
                </label>
                <label>
                  API Key
                  <input
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        openAiApiKey: event.target.value
                      })
                    }
                    type="password"
                    value={settings.openAiApiKey}
                  />
                </label>
              </>
            ) : null}
            {settings.agentProvider === 'cli-json' ? (
              <label>
                Command
                <input
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      cliCommand: event.target.value
                    })
                  }
                  placeholder='codex exec --skip-git-repo-check --ephemeral --ignore-rules --sandbox read-only --image "{imagePath}" -'
                  type="text"
                  value={settings.cliCommand}
                />
              </label>
            ) : null}
            {semanticTopdownRequested && settings.agentProvider !== 'local' ? (
              <div className="hint-box info">
                <Sparkles size={17} />
                <span>AI se redraw down/left/right/up semantic, khong rotate/flip/copy. CLI co the mat 2-5 phut.</span>
              </div>
            ) : null}
          </section>

          <section className="control-section">
            <div className="section-title">
              <FolderOpen size={18} />
              <h2>Output Folder</h2>
            </div>
            <div className="button-row">
              <button className="secondary-action" onClick={() => void handleSelectOutputFolder()}>
                <FolderOpen size={17} />
                Browse
              </button>
              <button className="icon-action" disabled={isSavingSettings} onClick={() => void handleSaveSettings()} title="Save settings">
                {isSavingSettings ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
              </button>
            </div>
            <input
              onChange={(event) =>
                setSettings({
                  ...settings,
                  outputRoot: event.target.value
                })
              }
              placeholder="Default: Documents\\AsePilot\\projects"
              type="text"
              value={settings.outputRoot}
            />
          </section>

          <section className="control-section">
            <div className="section-title">
              <Terminal size={18} />
              <h2>Aseprite</h2>
            </div>
            <div className="button-row">
              <button className="secondary-action" onClick={() => void handleSelectAseprite()}>
                <FolderOpen size={17} />
                Browse
              </button>
              <button className="icon-action" disabled={isSavingSettings} onClick={() => void handleSaveSettings()} title="Save settings">
                {isSavingSettings ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
              </button>
            </div>
            <input
              onChange={(event) =>
                setSettings({
                  ...settings,
                  asepritePath: event.target.value
                })
              }
              placeholder="C:\Program Files\Aseprite\Aseprite.exe"
              type="text"
              value={settings.asepritePath}
            />
          </section>
        </div>

        <div className="panel preview-panel">
          <div className="preview-header">
            <div>
              <h2>Output</h2>
              <p>{result ? result.projectId : 'Waiting for generation'}</p>
            </div>
            {result ? (
              <button className="icon-action" onClick={() => void window.asepilot.revealPath(result.projectRoot)} title="Open project folder">
                <ExternalLink size={18} />
              </button>
            ) : null}
          </div>

          {error ? (
            <div className="status-box error">
              <AlertTriangle size={20} />
              <span>{error}</span>
            </div>
          ) : null}

          {isRunning ? (
            <div className="empty-state">
              <Loader2 className="spin" size={30} />
              <span>Generating</span>
            </div>
          ) : null}

          {!isRunning && !result ? (
            <div className="empty-state">
              <ImagePlus size={30} />
              <span>No preview yet</span>
            </div>
          ) : null}

          {result ? (
            <div className="result-layout">
              <div className="image-stage">
                <img
                  alt="Generated pixel art preview"
                  key={result.previewPng}
                  onError={() => setError(`Preview exists but could not be displayed: ${result.previewPng}`)}
                  src={result.previewPngUrl}
                />
              </div>
              <div className="result-sidebar">
                <div className={`status-box ${result.aseprite.status}`}>
                  {result.aseprite.status === 'success' ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}
                  <span>{asepriteStatus}</span>
                </div>

                <div className="palette-strip">
                  {result.plan.palette.map((color) => (
                    <button
                      aria-label={`${color.name} ${color.hex}`}
                      className="swatch"
                      key={`${color.name}-${color.hex}`}
                      style={{ backgroundColor: color.hex }}
                      title={`${color.name} ${color.hex}`}
                      type="button"
                    />
                  ))}
                </div>

                <ArtifactButton icon={<ImagePlus size={17} />} label="Preview PNG" path={result.previewPng} />
                <ArtifactButton icon={<FileJson size={17} />} label="Pixel Plan" path={result.pixelPlan} />
                <ArtifactButton icon={<Terminal size={17} />} label="Lua Script" path={result.luaScript} />
                <ArtifactButton icon={<FolderOpen size={17} />} label="Aseprite File" path={result.asepriteFile} />
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function ArtifactButton({ icon, label, path }: { icon: ReactElement; label: string; path: string }): ReactElement {
  return (
    <button className="artifact-button" onClick={() => void window.asepilot.revealPath(path)}>
      {icon}
      <span>{label}</span>
      <ExternalLink size={15} />
    </button>
  );
}

function PathLine({ value }: { value: string }): ReactElement {
  return <div className="path-line">{value}</div>;
}

function toInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(1, Math.min(256, parsed));
}

function toOutputName(filePath: string): string {
  const filename = filePath.split(/[\\/]/).pop() ?? 'sprite';
  return filename.replace(/\.[^.]+$/, '') || 'sprite';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unexpected error';
}

function requiresAiTopdown(stylePreset: StylePreset, animationMode: AnimationMode): boolean {
  return stylePreset === 'top-down-character' && (animationMode === 'topdown-4dir' || animationMode === 'topdown-walk-8');
}
