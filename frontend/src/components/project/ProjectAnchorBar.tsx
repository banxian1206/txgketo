// components/project/ProjectAnchorBar.tsx —— 由 ProjectDetailPage 拆出（重构 1.6b · 只拆不改）
import type { Project } from '../../api/client'


export default function ProjectAnchorBar({
  AFTER_INITIATION,
  SECTIONS,
  active,
  scrollTo,
  p
}: {
  AFTER_INITIATION: string[];
  SECTIONS: { id: string; label: string }[];
  active: any;
  scrollTo: any;
  p: Project;
}) {
  return (
    <>
      {/* ============ 吸顶锚点条（不占左右空间，内容更宽） ============ */}
      <div className="anchor-bar">
        {SECTIONS.filter(
          (sec) =>
            !AFTER_INITIATION.includes(sec.id) ||
            (p.stage !== '线索' && p.stage !== '成交待立项'),
        ).map((sec) => (
          <a
            key={sec.id}
            className={active === sec.id ? 'active' : ''}
            onClick={() => scrollTo(sec.id)}
          >
            {sec.label}
          </a>
        ))}
      </div>

    </>
  )
}
