import { useState } from 'react';
import {
  THEME_IDS,
  THEMES,
  createRequestKey,
  type PptWorkCreateRequest,
  type ProjectSummary,
  type ThemeIdValue,
} from '@agent-workflow/shared';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';

const MIN_TOPIC_LENGTH = 6;

export interface PptCreateDialogProps {
  readonly projects: readonly ProjectSummary[];
  readonly projectsLoading: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onCreate: (body: PptWorkCreateRequest) => void;
}

/** 新建演示表单（放在对话框里）；创建仍走 W1-1 的 requestKey + 回执。 */
export function PptCreateDialog({ projects, projectsLoading, busy, onClose, onCreate }: PptCreateDialogProps) {
  const [projectId, setProjectId] = useState('');
  const [topic, setTopic] = useState('');
  const [theme, setTheme] = useState<ThemeIdValue>('deepseek');
  const valid = topic.trim().length >= MIN_TOPIC_LENGTH;

  const submit = (): void => {
    if (!valid || busy) return;
    onCreate({
      requestKey: createRequestKey(),
      ...(projectId === '' ? {} : { projectId }),
      title: topic.trim().slice(0, 40) || '未命名演示',
      topic: topic.trim(),
      theme,
      confirmCreate: true,
    });
  };

  return (
    <Modal
      open
      title="新建演示"
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            disabledReason={busy ? '创建请求已发出，正在等待服务回执。' : undefined}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            variant="primary"
            icon="plus"
            disabled={!valid || busy}
            disabledReason={
              busy ? '创建请求已发出，正在等待服务回执。' : !valid ? `至少写 ${String(MIN_TOPIC_LENGTH)} 个字说明主题。` : undefined
            }
            onClick={submit}
          >
            {busy ? '正在创建…' : '保存为演示草稿'}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        <div className="ppt-field-row">
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label className="label" htmlFor="ppt-new-project">
              项目<span className="opt">（可选）</span>
            </label>
            <select
              id="ppt-new-project"
              className="select"
              value={projectId}
              disabled={projectsLoading || busy}
              onChange={(event) => {
                setProjectId(event.target.value);
              }}
            >
              <option value="">不归属项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <span className="hint">
              {projectsLoading
                ? '正在读取项目列表…'
                : projects.length === 0
                  ? '服务里还没有项目；不选项目也可以创建与导出，只是生成时不读取项目资料。'
                  : '选项目后，生成大纲/逐页时会读取该项目的知识来源。'}
            </span>
          </div>
          <div className="field" style={{ flex: '0 0 190px' }}>
            <label className="label" htmlFor="ppt-new-theme">
              版式主题
            </label>
            <select
              id="ppt-new-theme"
              className="select"
              value={theme}
              disabled={busy}
              onChange={(event) => {
                setTheme(event.target.value as ThemeIdValue);
              }}
            >
              {THEME_IDS.map((id) => (
                <option key={id} value={id}>
                  {THEMES[id].label}（{id}）
                </option>
              ))}
            </select>
            <span className="hint">导出 PPTX 时使用对应背景/文字/强调色。</span>
          </div>
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="ppt-new-topic">
            你希望这份 PPT 讲什么<span className="req">*</span>
          </label>
          <textarea
            id="ppt-new-topic"
            className="textarea"
            value={topic}
            placeholder="对象、目的、大概几页。例如：给新同事讲项目架构与任务流程，约 6 页，20 分钟。"
            disabled={busy}
            onChange={(event) => {
              setTopic(event.target.value);
            }}
          />
          <div className="row" style={{ gap: 8 }}>
            <span className="hint grow">
              至少 {String(MIN_TOPIC_LENGTH)} 个字；这段说明会成为作品主题，标题取前 40 个字。保存会真实写入服务并返回回执。
            </span>
            <span className="hint num">{String(topic.length)} 字</span>
          </div>
        </div>

        <div className="banner info">
          <Icon name="info" />
          <div className="grow">创建成功后会刷新作品库并自动进入工作台；若没有收到回执，页面会显示 unknown 状态且不会自动重发。</div>
        </div>
      </div>
    </Modal>
  );
}
