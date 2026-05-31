import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileJson,
  FolderOpen,
  ImagePlus,
  Loader2,
  Palette,
  Save,
  Settings2,
  Sparkles,
  Terminal
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { STYLE_PRESETS, type PixelRequest, type StylePreset } from '../core/types';
import { stylePresetLabels, type AppSettings, type PipelineResultView } from '../shared/api';

const SIZE_PRESETS = [16, 32, 64, 128] as const;

export function App(): ReactElement {
  const [settings, setSettings] = useState<AppSettings>({ asepritePath: '', outputRoot: '' });
  const [imagePath, setImagePath] = useState('');
  const [targetWidth, setTargetWidth] = useState(32);
  const [targetHeight, setTargetHeight] = useState(32);
  const [paletteMax, setPaletteMax] = useState(16);
  const [stylePreset, setStylePreset] = useState<StylePreset>('rpg-item');
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

  const canGenerate = imagePath.trim().length > 0 && outputName.trim().length > 0 && !isRunning;
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
    const request: PixelRequest = {
      imagePath,
      targetWidth,
      targetHeight,
      paletteMax,
      stylePreset,
      outputName
    };

    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
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
              Output
              <input onChange={(event) => setOutputName(event.target.value)} type="text" value={outputName} />
            </label>
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
                <img alt="Generated pixel art preview" src={result.previewPngUrl} />
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
