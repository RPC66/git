import EmailLogin from './email-login';
import './login.css';
export const dynamic='force-dynamic';
export default async function LoginPage(){
  return <main className="login-shell">
    <section className="login-story"><a className="login-brand" href="/"><span>✳</span><div>日有所成<small>MAKE ROOM FOR PROGRESS</small></div></a><div className="story-main"><span className="story-eyebrow">A LITTLE BETTER, EVERY DAY</span><h1>你走过的每一步，<br/>都值得被记得。</h1><p>记录每天完成的小事，<br/>在回望时，看见自己的成长。</p><div className="story-preview" aria-hidden="true"><div className="preview-top"><span>今天的完成</span><small>一点一滴，都在积累</small></div><div><i>✓</i><span>读完期待已久的一章书<small>学习 · 25 分钟</small></span></div><div><i>✓</i><span>给自己留一点运动的时间<small>健康 · 30 分钟</small></span></div><div><i>✓</i><span>完成一件搁置的小事<small>生活</small></span></div></div><span className="sample-note">示例记录 · 你的故事，从登录开始</span></div><div className="story-footer"><span>◌ 云端保存</span><span>◷ 随时回顾</span><span>▧ 多端继续</span></div><div className="story-circle" aria-hidden="true"/></section>
    <section className="login-panel"><div className="login-card"><span className="welcome-eyebrow">WELCOME TO YOUR EVERYDAY</span><h2>欢迎，来记录今天。</h2><p className="login-subtitle">登录邮箱账号，把每一份完成好好收藏。</p><EmailLogin/></div><footer>日有所成 <span>·</span> 慢慢来，每一步都算数。</footer></section>
  </main>;
}
