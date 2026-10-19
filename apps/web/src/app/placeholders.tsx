import { Link } from 'react-router-dom';
import { LinkButton } from '../components/Button.tsx';
import { Card } from '../components/Card.tsx';
import { Icon } from '../components/Icon.tsx';

export function NotFoundPlaceholder() {
  return (
    <div className="page">
      <Card className="placeholder">
        <span className="tile">
          <Icon name="help" size="lg" />
        </span>
        <h2>页面不存在</h2>
        <p>没有找到这个地址。可以从左侧菜单返回正式页面，或回到主页。</p>
        <div className="actions">
          <LinkButton to="/" variant="primary" size="sm" icon="home">
            返回主页
          </LinkButton>
          <Link className="btn ghost sm" to="/tasks">
            <Icon name="list" size="sm" />
            任务列表
          </Link>
        </div>
      </Card>
    </div>
  );
}
