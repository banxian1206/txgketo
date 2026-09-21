"""修正单据编号：模板里不带项目号 → 必须全局按年取号，否则跨项目撞号

问题：TK/GR/MI/RV/RL 的模板是 {YY}{seq:03}，却按 project 取号 → TX26001 和 TX26002
各发一个 RV26001，评审单/发布批次的唯一约束直接报错（P5 演练发现）。
修正：这 5 类规则 scope=global_year，调用方传 scope_key=年（2026），流水按年全局递增。

Migration：把现有序列接到各表已有最大号之后（旧的项目级序列行删除）。

Revision ID: a7c1e3f50b26
Revises: f6a8c0d24e19
Create Date: 2026-09-21

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7c1e3f50b26"
down_revision: str | None = "f6a8c0d24e19"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# object_type → (表, 号码字段)：迁移里按各表已有最大号续号
RULES: list[tuple[str, str, str]] = [
    ("TASK", "task", "task_no"),
    ("ISSUE", "material_issue", "issue_no"),
    ("RECEIPT", "goods_receipt", "receipt_no"),
    ("REVIEW_TICKET", "review_ticket", "ticket_no"),
    ("DESIGN_RELEASE", "design_release", "release_no"),
]


def upgrade() -> None:
    for object_type, _table, _col in RULES:
        op.execute(
            sa.text(
                "DELETE FROM number_seq WHERE rule_id IN "
                "(SELECT id FROM number_rule WHERE object_type = :t)"
            ).bindparams(t=object_type)
        )
        op.execute(
            sa.text("UPDATE number_rule SET scope = 'global_year' WHERE object_type = :t").bindparams(
                t=object_type
            )
        )
        # 续号：接到已有最大号之后（号码形如 TK26001：前两位字母 + 两位年 + 3 位流水）
        op.execute(
            sa.text(
                f"""
                INSERT INTO number_seq (rule_id, scope_key, next_value)
                SELECT r.id, to_char(now(), 'YYYY'),
                       COALESCE((
                           SELECT MAX((substring({_col} from 5 for 3))::int)
                           FROM {_table}
                           WHERE {_col} ~ '^[A-Z]{{2}}[0-9]{{5}}$'
                       ), 0) + 1
                FROM number_rule r
                WHERE r.object_type = :t
                """
            ).bindparams(t=object_type)
        )


def downgrade() -> None:
    for object_type, _table, _col in RULES:
        op.execute(
            sa.text(
                "DELETE FROM number_seq WHERE rule_id IN "
                "(SELECT id FROM number_rule WHERE object_type = :t)"
            ).bindparams(t=object_type)
        )
        op.execute(
            sa.text("UPDATE number_rule SET scope = 'project' WHERE object_type = :t").bindparams(
                t=object_type
            )
        )
