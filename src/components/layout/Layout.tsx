import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import ToastContainer from '../common/ToastContainer';
import { useConfigStore } from '../../stores/useConfigStore';

function Layout() {
    const { config } = useConfigStore();
    const position = config?.sidebarPosition || 'left';
    const isTop = position === 'top';

    return (
        <div className={`h-screen flex ${isTop ? 'flex-col' : ''} bg-[#FAFBFC] dark:bg-base-300`}>
            {/* 全局窗口拖拽区域 */}
            <div
                className="fixed top-0 left-0 right-0 h-8"
                style={{
                    zIndex: 9999,
                    backgroundColor: 'rgba(0,0,0,0.001)',
                    cursor: 'default',
                    userSelect: 'none',
                    WebkitUserSelect: 'none'
                }}
                data-tauri-drag-region
            />
            <ToastContainer />

            {/* 左侧边栏 */}
            {position === 'left' && <Sidebar position="left" />}

            {/* 顶部导航 */}
            {isTop && <Sidebar position="top" />}

            {/* 中间内容 */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {!isTop && <Navbar />}
                <main className="flex-1 overflow-hidden flex flex-col relative">
                    <Outlet />
                </main>
            </div>

            {/* 右侧边栏 */}
            {position === 'right' && <Sidebar position="right" />}
        </div>
    );
}

export default Layout;
