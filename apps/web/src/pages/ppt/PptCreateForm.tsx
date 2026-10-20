import { useRef, useState } from 'react';
import { createRequestKey, type PptWorkCreateRequest, type ProjectSummary } from '@agent-workflow/shared';
import { errorMessage } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PptReceiptBanner, type PptReceiptState } from './ppt-shared.tsx';

export const PPT_MIN_TOPIC_LENGTH = 6;
/** 设计 ppt.html:73（未选项目时的示例想法 chip）。 */
const IDEAS = ['新人入门：项目架构说明', '季度复盘：交付与质量', '技术方案评审：恢复机制'] as const;

export interface PptCreateFormProps {
  readonly projects: readonly ProjectSummary[];
  readonly projectsLoading: boolean;
  readonly projectsError?: unknown;
  /** 创建命令的回执：失败/超时/UNKNOWN 直接渲染在创作框上方（P05-03）。 */
  readonly receipt: PptReceiptState | null;
  readonly busy: boolean;
  readonly onVerify: (requestKey: string) => void;
  readonly onRetryProjects: () => void;
  readonly onCreate: (body: PptWorkCreateRequest) => void;
  readonly onCancel?: () => void;
}

/**
 * 设计 ppt.html:58-72 的创作框：项目（必选）→ 主题 → 字数 → 开始讨论。
 * P05-02：恢复“先选项目再写主题”的门槛与「开始讨论」语义；
 * P05-05：版式主题不再前置到创建阶段；
 * P05-04：创建请求不携带附件，资料在创建后的工作台资料抽屉添加（诚实降级）。
 */
export function PptCreateForm({
  projects,
  projectsLoading,
  projectsError,
  receipt,
  busy,
  onVerify,
  onRetryProjects,
  onCreate,
  onCancel,
}: PptCreateFormProps) {
  const [projectId, setProjectId] = useState('');
  const [topic, setTopic] = useState('');
  const topicRef = useRef<HTMLTextAreaElement | null>(null);
  const projectsReady = !projectsLoading && projectsError === undefined;
  const projectRequired = projects.length > 0;
  /* UNKNOWN/accepted 时锁定：只核对原请求号，不用新 key 重发（P05-03）。 */
  const outcomeUnknown = receipt?.outcome === 'unknown' || receipt?.outcome === 'accepted';
  const locked = busy || outcomeUnknown;
  const canWrite = projectsReady && projectId !== '';
  const valid = projectRequired && projectsReady && canWrite && topic.trim().length >= PPT_MIN_TOPIC_LENGTH;
  const submit = (): void => {
    if (!valid || locked) return;
    onCreate({
      requestKey: createRequestKey(),
      projectId,
      title: topic.trim().slice(0, 40) || '未命名演示',
      topic: topic.trim(),
      confirmCreate: true,
    });
  };
  const pickIdea = (idea: string): void => {
    if (projectId === '' && projects[0] !== undefined) setProjectId(projects[0].id);
    setTopic(idea);
    requestAnimationFrame(() => topicRef.current?.focus());
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      {receipt === null ? null : <PptReceiptBanner state={receipt} onVerify={onVerify} />}
      {receipt?.outcome === 'failed' ? (
        <p className="hint" role="status">
          服务没有创建作品：你写的内容还在，可以直接重试（重试会使用新的请求号）。
        </p>
      ) : null}
      {projectsError === undefined ? null : (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div className="grow">
            <b>项目列表读取失败</b>
            <br />
            {errorMessage(projectsError)}
            <br />
            读取失败不等于“没有项目”，修复连接后重新读取即可。
          </div>
          <Button variant="secondary" size="sm" onClick={onRetryProjects}>
            重新读取项目
          </Button>
        </div>
      )}

      <div className="ppt-create-box">
        <div className="ppt-create-top">
          <label className="label" htmlFor="ppt-create-project" style={{ margin: 0 }}>
            项目<span className="req">*</span>
          </label>
          <select
            id="ppt-create-project"
            className="select"
            style={{ flex: '1 1 200px', maxWidth: 280 }}
            value={projectId}
            disabled={locked || projectsLoading || !projectRequired}
            onChange={(event) => {
              setProjectId(event.target.value);
            }}
          >
            <option value="">{projectsLoading ? '正在读取项目…' : projectRequired ? '先选择项目' : '服务里还没有项目'}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <span className="hint grow">
            {projectRequired ? '演示会使用这个项目的资料和公约' : '演示归属于一个项目，便于引用资料'}
          </span>
        </div>
        <label htmlFor="ppt-create-topic" className="sr">
          你希望这份 PPT 讲什么
        </label>
        <textarea
          id="ppt-create-topic"
          ref={topicRef}
          className="ppt-create-topic"
          value={topic}
          disabled={!canWrite || locked}
          placeholder={canWrite ? '你希望这份 PPT 讲什么？给谁看、想达到什么效果、大概几页…' : '选择项目后填写'}
          onChange={(event) => {
            setTopic(event.target.value);
          }}
        />
        <div className="ppt-create-bottom">
          <span className="row" style={{ gap: 6 }}>
            <Button
              variant="ghost"
              size="sm"
              icon="upload"
              disabled
              disabledReason="创建请求不携带附件；创建后在工作台「资料」抽屉添加，生成时会读取项目资料。"
            >
              添加资料
            </Button>
            <span className="hint">资料在创建后添加</span>
          </span>
          <span className="grow" />
          {onCancel === undefined ? null : (
            <Button variant="ghost" disabled={busy} onClick={onCancel}>
              取消
            </Button>
          )}
          <span className="hint num">{String(topic.length)} 字</span>
          <Button
            variant="primary"
            iconAfter="arrowRight"
            disabled={!valid || locked}
            disabledReason={
              !projectRequired
                ? '服务里还没有项目：演示需要归属于一个项目，先创建项目再开始讨论。'
                : projectsError !== undefined
                  ? '项目列表读取失败，先重新读取项目。'
                  : projectId === ''
                    ? '先选择项目。'
                    : topic.trim().length < PPT_MIN_TOPIC_LENGTH
                      ? `至少写 ${String(PPT_MIN_TOPIC_LENGTH)} 个字说明主题。`
                      : outcomeUnknown
                        ? '原创建请求结果未明：先按原请求号核对，不能自动重发。'
                        : undefined
            }
            onClick={submit}
          >
            {busy ? '正在创建…' : '开始讨论'}
          </Button>
        </div>
      </div>

      {projectsReady && projectRequired && projectId === '' ? (
        <div className="ppt-create-ideas">
          {IDEAS.map((idea) => (
            <button key={idea} type="button" onClick={() => pickIdea(idea)}>
              {idea}
            </button>
          ))}
        </div>
      ) : null}
      {projectsReady && !projectRequired ? (
        <div className="banner info" style={{ maxWidth: 780, margin: '0 auto' }}>
          <Icon name="info" />
          <div className="grow">服务里还没有项目：设计约定演示归属于项目。先到「项目」创建项目，再回来开始讨论。</div>
          <a className="btn secondary sm" href="/projects">
            去项目页
          </a>
        </div>
      ) : null}
    </div>
  );
}
