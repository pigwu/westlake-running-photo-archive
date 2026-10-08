import React, { useState, useEffect, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  Camera,
  Images,
  CalendarDays,
  Users,
  Heart,
  Trash2,
  HardDrive,
  Search,
  Plus,
  ChevronRight,
  ChevronDown,
  ArrowUpRight,
  Upload,
  Grid2X2,
  Rows3,
  SlidersHorizontal,
  X,
  Check,
  FolderOpen,
  Download,
  MapPin,
  ScanFace,
  LoaderCircle,
  Cloud,
  CheckCheck,
  RotateCcw,
  ImagePlus,
  Tag,
  Link,
  Settings2,
  ExternalLink,
  Menu,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Merge,
} from "lucide-react";
import { api } from "./api";
import "./styles.css";
const formatDate = (d) => d?.replaceAll("-", ".");
const bytes = (n) =>
  n >= 1024 ** 3
    ? (n / 1024 ** 3).toFixed(2) + " GB"
    : n >= 1024 ** 2
      ? (n / 1024 ** 2).toFixed(1) + " MB"
      : n >= 1024
        ? (n / 1024).toFixed(0) + " KB"
        : n + " B";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function IconButton({ icon: Icon, label, className = "", ...props }) {
  return (
    <button
      className={"icon-button " + className}
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={18} />
    </button>
  );
}
function Dialog({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={"dialog " + (wide ? "dialog-wide" : "")}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <div>
          <span className="eyebrow">SHIGUANG ARCHIVE</span>
          <h2>{title}</h2>
        </div>
        <IconButton icon={X} label="关闭" onClick={onClose} />
      </header>
      {children}
    </dialog>
  );
}
function App() {
  const [photos, setPhotos] = useState([]),
    [events, setEvents] = useState([]),
    [people, setPeople] = useState([]),
    [status, setStatus] = useState(null);
  const [view, setView] = useState("all"),
    [query, setQuery] = useState(""),
    [activity, setActivity] = useState(""),
    [person, setPerson] = useState(""),
    [period, setPeriod] = useState(""),
    [sort, setSort] = useState("new"),
    [layout, setLayout] = useState("grid");
  const [selected, setSelected] = useState(new Set()),
    [modal, setModal] = useState(null),
    [current, setCurrent] = useState(null),
    [toast, setToast] = useState(null),
    [loading, setLoading] = useState(true),
    [needsLogin, setNeedsLogin] = useState(false),
    [showDemo, setShowDemo] = useState(true),
    [mobileNav, setMobileNav] = useState(false);
  const [analysis, setAnalysis] = useState(null),
    [scanBusy, setScanBusy] = useState(false);
  const stopAnalysis = useRef(false);
  const toastTimer = useRef();
  const notify = (message, type = "success") => {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };
  const load = async () => {
    try {
      const [p, e, pe, s] = await Promise.all([
        api("/photos"),
        api("/events"),
        api("/people"),
        api("/status"),
      ]);
      setPhotos(p);
      setEvents(e);
      setPeople(pe);
      setStatus(s);
      setNeedsLogin(false);
    } catch (e) {
      if (e.status === 401) setNeedsLogin(true);
      else notify(e.message, "error");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const real = photos.filter((p) => !p.demo && !p.trash);
  const isDemo = showDemo && photos.filter((p) => !p.demo).length === 0;
  const pool = photos.filter((p) => (isDemo ? p.demo : !p.demo));
  const activeEvents = events.filter((e) =>
    isDemo ? true : !e.id.startsWith("demo-"),
  );
  const navigate = (v) => {
    setView(v);
    setSelected(new Set());
    setActivity("");
    setPerson("");
    setPeriod("");
    setQuery("");
    setMobileNav(false);
  };
  const filtered = useMemo(
    () =>
      pool
        .filter((p) => (view === "trash" ? p.trash : !p.trash))
        .filter((p) => view !== "favorites" || p.favorite)
        .filter((p) => !activity || p.eventId === activity)
        .filter((p) => !person || p.people.some((pe) => pe.id === person))
        .filter((p) => !period || p.date.startsWith(period))
        .filter(
          (p) =>
            !query ||
            [
              p.name,
              p.eventTitle,
              p.location,
              ...p.tags,
              ...p.people.map((pe) => pe.name),
            ]
              .join(" ")
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "old"
            ? a.date.localeCompare(b.date)
            : b.date.localeCompare(a.date),
        ),
    [pool, view, activity, person, period, query, sort],
  );
  const latest = activeEvents.find((e) => e.photoCount > 0);
  const heroPhoto =
    (isDemo ? pool.find((p) => p.id === "demo-1") : null) ||
    pool.find((p) => p.eventId === latest?.id && !p.trash);
  const months = [
    ...new Set(pool.filter((p) => !p.trash).map((p) => p.date.slice(0, 7))),
  ]
    .sort()
    .reverse();
  const pending = real.filter((p) => !p.analyzed);
  const canEdit = status?.role !== "viewer";
  const toggleSelect = (id) =>
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  const patch = async (ids, changes, message) => {
    try {
      for (let offset = 0; offset < ids.length; offset += 500)
        await api("/photos", {
          method: "PATCH",
          body: { ids: ids.slice(offset, offset + 500), changes },
        });
      await load();
      if (message) notify(message);
      return true;
    } catch (e) {
      notify(e.message, "error");
      return false;
    }
  };
  const scan = async () => {
    setScanBusy(true);
    try {
      const r = await api("/scan", { method: "POST", body: {} });
      await load();
      notify(
        `新增 ${r.added} 张，跳过 ${r.duplicates} 张重复照片${r.errors ? `，${r.errors} 张读取失败` : ""}`,
        r.errors ? "error" : "success",
      );
      if (r.messages?.length) notify(r.messages.join("；"), "error");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setScanBusy(false);
    }
  };
  const analyze = async () => {
    if (!pending.length) {
      notify("请先上传真实照片，再开始分组");
      return;
    }
    stopAnalysis.current = false;
    setAnalysis({ done: 0, total: pending.length, phase: "加载本地人脸模型…" });
    let completed = 0,
      failures = 0;
    try {
      const { analyzePhoto } = await import("./faces");
      for (const photo of pending) {
        if (stopAnalysis.current) break;
        setAnalysis({
          done: completed,
          total: pending.length,
          phase: `正在分析 ${photo.name}`,
        });
        try {
          const faces = await analyzePhoto(photo);
          await api("/faces", {
            method: "POST",
            body: { photoId: photo.id, faces },
          });
        } catch (e) {
          failures++;
          if (failures === 1) notify(`${photo.name}：${e.message}`, "error");
        }
        completed++;
        setAnalysis({
          done: completed,
          total: pending.length,
          phase: "整理成员分组…",
        });
        await new Promise((r) => setTimeout(r, 30));
      }
      await load();
      notify(
        `已分析 ${completed - failures} 张照片${failures ? `，${failures} 张失败，可重试` : ""}`,
      );
    } catch (e) {
      notify("人脸模型加载失败，请检查本地模型文件", "error");
    } finally {
      setAnalysis(null);
    }
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setCurrent(null);
        setSelected(new Set());
      }
      if (
        current &&
        !modal &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)
      ) {
        const index = filtered.findIndex((p) => p.id === current.id);
        if (e.key === "ArrowRight")
          setCurrent(filtered[(index + 1) % filtered.length]);
        if (e.key === "ArrowLeft")
          setCurrent(filtered[(index - 1 + filtered.length) % filtered.length]);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        document.querySelector("#photo-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, filtered, modal]);
  const title =
    view === "all"
      ? "照片档案"
      : view === "events"
        ? "活动相册"
        : view === "people"
          ? "跑友面孔"
          : view === "favorites"
            ? "我的收藏"
            : view === "trash"
              ? "回收站"
              : "存储与连接";
  return (
    <div className={"app-shell " + (canEdit ? "" : "viewer")}>
      <aside className={"sidebar " + (mobileNav ? "mobile-open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("all");
          }}
        >
          <span className="brand-mark">
            <Camera size={25} />
          </span>
          <span>
            <strong>
              拾光<span className="brand-dot">.</span>
            </strong>
            <small>跑团的共同记忆</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-logo">W</span>
          <div>
            <b>西湖跑团</b>
            <small>RUNNING CLUB</small>
          </div>
          <span className="workspace-label">档案库</span>
        </div>
        <div className="nav-section-label">你的照片库</div>
        <nav>
          {[
            {
              id: "all",
              label: "全部照片",
              icon: Images,
              count: pool.filter((p) => !p.trash).length,
            },
            {
              id: "events",
              label: "活动相册",
              icon: CalendarDays,
              count: activeEvents.length,
            },
            { id: "people", label: "跑友面孔", icon: Users },
          ].map((n) => (
            <button
              key={n.id}
              onClick={() => navigate(n.id)}
              className={"nav-item " + (view === n.id ? "active" : "")}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.count !== undefined && (
                <span className="nav-count">{n.count}</span>
              )}
            </button>
          ))}
          <div className="nav-divider" />
          <button
            className={"nav-item " + (view === "favorites" ? "active" : "")}
            onClick={() => navigate("favorites")}
          >
            <Heart size={19} />
            <span>我的收藏</span>
          </button>
          <button
            className={"nav-item " + (view === "trash" ? "active" : "")}
            onClick={() => navigate("trash")}
          >
            <Trash2 size={19} />
            <span>回收站</span>
          </button>
        </nav>
        <div className="sidebar-event-heading">
          <span className="nav-section-label">最近活动</span>
          <IconButton
            icon={Plus}
            label="创建活动"
            onClick={() => setModal({ type: "event" })}
          />
        </div>
        <div className="recent-events">
          {activeEvents.slice(0, 3).map((e, i) => (
            <button
              key={e.id}
              onClick={() => {
                navigate("all");
                setActivity(e.id);
              }}
            >
              <span className={"event-dot dot-" + i} />
              <span>{e.title.split(" · ")[0]}</span>
              <ChevronRight size={14} />
            </button>
          ))}
          {!activeEvents.length && <p>创建活动，开始记录</p>}
        </div>
        <div className="sidebar-bottom">
          <button
            className={
              "storage-card " + (view === "storage" ? "storage-active" : "")
            }
            onClick={() => navigate("storage")}
          >
            <div className="storage-card-top">
              <HardDrive size={18} />
              <b>{status?.configured ? "办公网盘目录" : "连接办公网盘"}</b>
              <ChevronRight size={15} />
            </div>
            <p>
              {status?.configured
                ? "原图存储在指定同步目录"
                : "让每一次奔跑都有归处"}
            </p>
            <div className="storage-track">
              <span style={{ width: status?.count ? "34%" : "0%" }} />
            </div>
            <small>
              {status?.count || 0} 张原图
              <span>{bytes(status?.bytes || 0)}</span>
            </small>
          </button>
          <div className="club-profile">
            <span className="profile-avatar">W</span>
            <div>
              <b>西湖跑团</b>
              <small>照片档案工作空间</small>
            </div>
            <span className="profile-dots">···</span>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <div className="nav-scrim" onClick={() => setMobileNav(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu icon-button"
              aria-label="打开导航"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu size={20} />
            </button>
            <span>跑团工作空间</span>
            <ChevronRight size={14} />
            <b>{title}</b>
          </div>
          <div className="topbar-right">
            <span className="local-status">
              <span />
              {status?.configured ? "目录已配置" : "本地工作空间"}
            </span>
            <span className="top-avatar">W</span>
            {status?.authentication && (
              <button
                className="logout-button"
                onClick={async () => {
                  await api("/logout", { method: "POST", body: {} });
                  setPhotos([]);
                  setEvents([]);
                  setPeople([]);
                  setStatus(null);
                  setNeedsLogin(true);
                  setCurrent(null);
                  setModal(null);
                  navigate("all");
                }}
              >
                {canEdit ? "管理" : "浏览"} · 退出
              </button>
            )}
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">OUR MILES, OUR MEMORIES</div>
              <h1>
                {title}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {view === "all"
                  ? "一起跑过的风景，值得好好收藏。"
                  : view === "events"
                    ? "每一场出发，都是一段共同的故事。"
                    : view === "people"
                      ? "从一张合影，找到一起奔跑的人。"
                      : view === "favorites"
                        ? "把喜欢的瞬间，再看一遍。"
                        : view === "trash"
                          ? "这里的照片可以恢复，原文件仍保留在存储目录。"
                          : "把照片留在自己的存储空间。"}
              </p>
            </div>
            {!["storage", "trash"].includes(view) && (
              <button
                className="button button-dark"
                onClick={() => setModal({ type: "upload" })}
              >
                <Plus size={19} />
                上传照片
              </button>
            )}
          </div>
          {isDemo && view !== "storage" && (
            <div className="demo-notice">
              <span>
                <span className="demo-tag">示例档案</span>
                先看看照片库的样子，上传后将显示你的真实照片。
              </span>
              <button
                onClick={() => {
                  setShowDemo(false);
                  setSelected(new Set());
                }}
              >
                开始我的档案
                <ArrowUpRight size={14} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              正在打开照片库…
            </div>
          ) : view === "storage" ? (
            <Storage
              status={status}
              scan={scan}
              scanBusy={scanBusy}
              load={load}
              notify={notify}
            />
          ) : view === "events" ? (
            <>
              <div className="section-row">
                <h2>
                  一起出发的日子 <span>{activeEvents.length}</span>
                </h2>
                <button
                  className="button button-outline"
                  onClick={() => setModal({ type: "event" })}
                >
                  <Plus size={16} />
                  新建活动
                </button>
              </div>
              <div className="album-grid">
                {activeEvents.map((e) => {
                  const cover = pool.find(
                    (p) => p.eventId === e.id && !p.trash,
                  );
                  return (
                    <article className="album-card" key={e.id}>
                      <button
                        className="album-cover"
                        onClick={() => {
                          navigate("all");
                          setActivity(e.id);
                        }}
                      >
                        {cover ? (
                          <img src={cover.thumb} alt={e.title} />
                        ) : (
                          <div className="album-placeholder">
                            <CalendarDays size={40} />
                          </div>
                        )}
                        <span className="album-photo-count">
                          <Images size={14} />
                          {e.photoCount} 张
                        </span>
                      </button>
                      <div className="album-info">
                        <span className="eyebrow">{formatDate(e.date)}</span>
                        <h3>
                          <button
                            onClick={() => {
                              navigate("all");
                              setActivity(e.id);
                            }}
                          >
                            {e.title}
                          </button>
                        </h3>
                        <p>
                          <MapPin size={14} />
                          {e.location || "地点待补充"}
                          <button
                            aria-label={"编辑" + e.title}
                            onClick={() =>
                              setModal({ type: "event", event: e })
                            }
                          >
                            <Settings2 size={16} />
                          </button>
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
              {!activeEvents.length && (
                <Empty
                  icon={CalendarDays}
                  title="下一次出发，从这里开始"
                  text="创建一个活动，把同一天的照片收进一本相册。"
                  action={canEdit ? "创建活动" : null}
                  onAction={() => setModal({ type: "event" })}
                />
              )}
            </>
          ) : view === "people" ? (
            <>
              <div className="face-banner">
                <div className="face-symbol">
                  <ScanFace size={42} />
                </div>
                <div>
                  <h2>照片里的人，也有自己的相册</h2>
                  <p>
                    在本机浏览器分析人脸，自动整理相似面孔。给分组命名，让跑友更容易找到自己的照片。
                  </p>
                  <div className="face-badges">
                    <span>
                      <Check size={14} />
                      原图不发送给第三方
                    </span>
                    <span>
                      <Users size={14} />
                      分组支持命名与合并
                    </span>
                  </div>
                </div>
                <button
                  className="button button-dark"
                  disabled={!!analysis}
                  onClick={analyze}
                >
                  {analysis ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <ScanFace size={18} />
                  )}{" "}
                  {analysis
                    ? "正在分组"
                    : `开始人脸分组${pending.length ? " · " + pending.length + " 张" : ""}`}
                </button>
              </div>
              {analysis && (
                <div className="analysis-progress">
                  <div>
                    <span>{analysis.phase}</span>
                    <button
                      onClick={() => {
                        stopAnalysis.current = true;
                        notify("当前照片完成后停止");
                      }}
                    >
                      停止
                    </button>
                  </div>
                  <progress value={analysis.done} max={analysis.total} />
                  <small>
                    {analysis.done} / {analysis.total} 张
                  </small>
                </div>
              )}
              <div className="section-row">
                <h2>
                  成员分组 <span>{people.length}</span>
                </h2>
                <span className="muted">
                  自动分组结果请确认，可合并同一成员
                </span>
              </div>
              <div className="people-grid">
                {people.map((p) => (
                  <article className="person-card" key={p.id}>
                    <button
                      className="person-cover"
                      onClick={() => {
                        navigate("all");
                        setPerson(p.id);
                      }}
                    >
                      {p.avatar ? (
                        <img src={p.avatar} alt={p.name} />
                      ) : (
                        <Users size={45} />
                      )}
                    </button>
                    <button
                      className="person-name"
                      disabled={!canEdit}
                      onClick={() => setModal({ type: "person", person: p })}
                    >
                      {p.name}
                      <Settings2 size={14} />
                    </button>
                    <p>{p.photoCount} 张照片</p>
                    <button
                      className="small-link"
                      onClick={() => setModal({ type: "merge", person: p })}
                    >
                      <Merge size={13} />
                      合并分组
                    </button>
                  </article>
                ))}
              </div>
              {!people.length && (
                <Empty
                  icon={Users}
                  title="等一个熟悉的面孔"
                  text="上传跑团照片后，点击「开始人脸分组」。清晰的正面照片能获得更好的结果。"
                  action={canEdit ? "上传照片" : null}
                  onAction={() => setModal({ type: "upload" })}
                />
              )}
            </>
          ) : (
            <>
              {view === "all" &&
                !activity &&
                !person &&
                !query &&
                !period &&
                heroPhoto && (
                  <section className="featured">
                    <img src={heroPhoto.thumb} alt={latest.title} />
                    <div className="featured-shade" />
                    <div className="featured-content">
                      <span className="feature-label">
                        <span />
                        最近的一次出发{" "}
                        <span className="feature-divider">/</span>{" "}
                        {formatDate(latest.date)}
                      </span>
                      <h2>
                        {latest.title.split(" · ")[0]}
                        <br />
                        <span>
                          {latest.title.split(" · ")[1] || "每一步，都算数"}
                        </span>
                      </h2>
                      <div className="featured-bottom">
                        <span>
                          <MapPin size={15} />
                          {latest.location}
                          <span className="feature-divider">·</span>
                          <Images size={15} />
                          {latest.photoCount} 张照片
                        </span>
                        <button onClick={() => setActivity(latest.id)}>
                          打开相册 <ArrowUpRight size={17} />
                        </button>
                      </div>
                    </div>
                    <div className="featured-stamp">
                      LET'S
                      <br />
                      RUN<span>TOGETHER ↗</span>
                    </div>
                  </section>
                )}
              <div className="library-toolbar">
                <div className="library-tabs">
                  <button
                    className={!period ? "selected" : ""}
                    onClick={() => setPeriod("")}
                  >
                    {view === "favorites"
                      ? "收藏照片"
                      : view === "trash"
                        ? "已移入回收站"
                        : "所有照片"}
                    <span>{filtered.length}</span>
                  </button>
                  <select
                    aria-label="按月份筛选"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                  >
                    <option value="">按日期浏览</option>
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {m.replace("-", " 年 ")} 月
                      </option>
                    ))}
                  </select>
                </div>
                <div className="toolbar-controls">
                  <select
                    aria-label="照片排序"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="new">最新优先</option>
                    <option value="old">最早优先</option>
                  </select>
                  <div className="view-switch">
                    <IconButton
                      icon={Grid2X2}
                      label="网格视图"
                      className={layout === "grid" ? "active" : ""}
                      onClick={() => setLayout("grid")}
                    />
                    <IconButton
                      icon={Rows3}
                      label="时间线视图"
                      className={layout === "timeline" ? "active" : ""}
                      onClick={() => setLayout("timeline")}
                    />
                  </div>
                </div>
              </div>
              <div className="filter-row">
                <label className="search-field">
                  <Search size={18} />
                  <input
                    id="photo-search"
                    placeholder="搜索照片、活动、标签或跑友…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query ? (
                    <button aria-label="清除搜索" onClick={() => setQuery("")}>
                      <X size={15} />
                    </button>
                  ) : (
                    <kbd>Ctrl K</kbd>
                  )}
                </label>
                <label className="activity-filter">
                  <SlidersHorizontal size={16} />
                  <select
                    aria-label="筛选活动"
                    value={activity}
                    onChange={(e) => {
                      setActivity(e.target.value);
                      setSelected(new Set());
                    }}
                  >
                    <option value="">全部活动</option>
                    {activeEvents.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className={
                    "button button-outline select-toggle " +
                    (selected.size ? "selected" : "")
                  }
                  onClick={() =>
                    setSelected(
                      selected.size
                        ? new Set()
                        : new Set(filtered.map((p) => p.id)),
                    )
                  }
                >
                  <CheckCheck size={16} />
                  {selected.size ? "取消选择" : "批量选择"}
                </button>
              </div>
              {person && (
                <div className="filter-chip">
                  <Users size={14} />
                  {people.find((p) => p.id === person)?.name}
                  <button
                    aria-label="清除成员筛选"
                    onClick={() => setPerson("")}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              {filtered.length > 0 ? (
                <>
                  {layout === "timeline" ? (
                    [...new Set(filtered.map((p) => p.date))].map((date) => (
                      <section className="timeline-group" key={date}>
                        <div className="date-heading">
                          <span />
                          {formatDate(date)}
                          <small>
                            {filtered.filter((p) => p.date === date).length}{" "}
                            张照片
                          </small>
                        </div>
                        <PhotoGrid
                          photos={filtered.filter((p) => p.date === date)}
                          selected={selected}
                          toggleSelect={toggleSelect}
                          open={setCurrent}
                          patch={patch}
                        />
                      </section>
                    ))
                  ) : (
                    <>
                      <div className="photo-group-label">
                        <span>
                          {period
                            ? period.replace("-", " 年 ") + " 月"
                            : activity
                              ? activeEvents.find((e) => e.id === activity)
                                  ?.title
                              : "每一个尽兴的瞬间"}
                        </span>
                        <small>{filtered.length} 张照片</small>
                      </div>
                      <PhotoGrid
                        photos={filtered}
                        selected={selected}
                        toggleSelect={toggleSelect}
                        open={setCurrent}
                        patch={patch}
                      />
                    </>
                  )}
                  <div className="library-end">
                    <span />
                    <Camera size={16} />
                    <span />
                    <p>已经看完啦，下一次出发见。</p>
                  </div>
                </>
              ) : (
                <Empty
                  icon={view === "trash" ? Trash2 : Images}
                  title={
                    query || activity || period || person
                      ? "没有找到匹配的照片"
                      : view === "trash"
                        ? "回收站是空的"
                        : view === "favorites"
                          ? "收藏你的第一个瞬间"
                          : "把第一段回忆放进来"
                  }
                  text={
                    query || activity || period || person
                      ? "试试其他关键词，或调整筛选条件。"
                      : "支持批量上传，按日期和活动整理。"
                  }
                  action={
                    query || activity || period || person
                      ? "清除筛选"
                      : view === "trash" || !canEdit
                        ? null
                        : "上传照片"
                  }
                  onAction={() =>
                    query || activity || period || person
                      ? (setQuery(""),
                        setActivity(""),
                        setPeriod(""),
                        setPerson(""))
                      : setModal({ type: "upload" })
                  }
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <Camera size={13} />
              拾光 · 每一步，都值得记住
            </span>
            <span>
              {isDemo
                ? "示例照片来自 Unsplash"
                : `${real.length} 张原图 · ${bytes(status?.bytes || 0)}`}
              <span className="footer-divider">/</span>{" "}
              {status?.configured ? "办公网盘同步目录" : "存储在本机"}
            </span>
          </footer>
        </main>
      </div>
      {selected.size > 0 && (
        <div className="selection-bar">
          <span className="selection-count">
            <Check size={15} />
            {selected.size}
          </span>
          <b>张照片已选择</b>
          <span className="selection-divider" />
          {view === "trash" ? (
            <button
              onClick={async () => {
                await patch([...selected], { trash: false }, "照片已恢复");
                setSelected(new Set());
              }}
            >
              <RotateCcw size={17} />
              恢复照片
            </button>
          ) : (
            <>
              <button
                onClick={() => setModal({ type: "tag", ids: [...selected] })}
              >
                <Tag size={17} />
                标记活动 / 日期
              </button>
              <button
                onClick={() =>
                  patch([...selected], { favorite: true }, "已加入收藏")
                }
              >
                <Heart size={17} />
                收藏
              </button>
              <button
                onClick={() => setModal({ type: "trash", ids: [...selected] })}
              >
                <Trash2 size={17} />
                移入回收站
              </button>
            </>
          )}
          <IconButton
            icon={X}
            label="取消选择"
            onClick={() => setSelected(new Set())}
          />
        </div>
      )}
      {toast && (
        <div className={"toast " + toast.type} role="status">
          {toast.type === "error" ? (
            <AlertCircle size={19} />
          ) : (
            <CheckCircle2 size={19} />
          )}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="关闭提示">
            <X size={16} />
          </button>
        </div>
      )}
      {needsLogin && <Login onSuccess={load} />}
      {modal?.type === "upload" && (
        <UploadDialog
          events={events.filter((e) => !e.id.startsWith("demo-"))}
          onClose={() => setModal(null)}
          load={load}
          notify={notify}
          initialEvent={
            activity && !activity.startsWith("demo-") ? activity : ""
          }
          configured={status?.configured}
        />
      )}
      {modal?.type === "event" && (
        <EventDialog
          event={modal.event}
          onClose={() => setModal(null)}
          load={load}
          notify={notify}
        />
      )}
      {modal?.type === "tag" && (
        <TagDialog
          ids={modal.ids}
          events={activeEvents}
          photos={photos}
          onClose={() => setModal(null)}
          patch={patch}
        />
      )}
      {modal?.type === "person" && (
        <RenameDialog
          person={modal.person}
          onClose={() => setModal(null)}
          load={load}
          notify={notify}
        />
      )}
      {modal?.type === "merge" && (
        <MergeDialog
          person={modal.person}
          people={people}
          onClose={() => setModal(null)}
          load={load}
          notify={notify}
        />
      )}
      {modal?.type === "trash" && (
        <Dialog title="移入回收站？" onClose={() => setModal(null)}>
          <p className="dialog-description">
            选中的 {modal.ids.length}{" "}
            张照片会从相册隐藏。原文件保留在网盘目录，随时可以恢复。
          </p>
          <div className="dialog-actions">
            <button
              className="button button-outline"
              onClick={() => setModal(null)}
            >
              取消
            </button>
            <button
              className="button button-dark"
              onClick={async () => {
                await patch(modal.ids, { trash: true }, "已移入回收站");
                setSelected(new Set());
                setCurrent(null);
                setModal(null);
              }}
            >
              移入回收站
            </button>
          </div>
        </Dialog>
      )}
      {current && (
        <PhotoDetail
          canEdit={canEdit}
          photo={photos.find((p) => p.id === current.id) || current}
          events={events}
          onClose={() => setCurrent(null)}
          patch={patch}
          onTag={() => setModal({ type: "tag", ids: [current.id] })}
          onTrash={() => setModal({ type: "trash", ids: [current.id] })}
          onNext={(delta) => {
            const i = filtered.findIndex((p) => p.id === current.id);
            setCurrent(
              filtered[(i + delta + filtered.length) % filtered.length],
            );
          }}
        />
      )}
    </div>
  );
}
function PhotoGrid({ photos, selected, toggleSelect, open, patch }) {
  return (
    <div className="photo-grid">
      {photos.map((p, i) => (
        <article
          key={p.id}
          className={"photo-card " + (selected.has(p.id) ? "is-selected" : "")}
        >
          <div className={"photo-image image-" + (i % 5)}>
            <button
              className="photo-open"
              aria-label={"查看 " + p.name}
              onClick={() => open(p)}
            >
              <img
                src={p.thumb}
                alt={p.eventTitle || p.name}
                loading={i < 8 ? "eager" : "lazy"}
              />
            </button>
            <button
              className={
                "photo-checkbox " + (selected.has(p.id) ? "checked" : "")
              }
              aria-label={"选择 " + p.name}
              onClick={() => toggleSelect(p.id)}
            >
              {selected.has(p.id) && <Check size={15} />}
            </button>
            <button
              className={"photo-heart " + (p.favorite ? "hearted" : "")}
              aria-label={p.favorite ? "取消收藏" : "收藏照片"}
              onClick={() => patch([p.id], { favorite: !p.favorite })}
            >
              <Heart size={16} fill={p.favorite ? "currentColor" : "none"} />
            </button>
            <span className="photo-image-label">
              {p.demo ? (
                "示例"
              ) : p.analyzed ? (
                <>
                  <ScanFace size={13} />
                  {p.people.length ? "已分组" : "已分析"}
                </>
              ) : (
                <>
                  <Camera size={13} />
                  原图
                </>
              )}
            </span>
          </div>
          <div className="photo-meta">
            <span>{p.eventTitle?.split(" · ")[0] || p.name}</span>
            <small>{formatDate(p.date)}</small>
          </div>
        </article>
      ))}
    </div>
  );
}
function Empty({ icon: Icon, title, text, action, onAction }) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={34} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="button button-dark" onClick={onAction}>
          <Plus size={16} />
          {action}
        </button>
      )}
    </div>
  );
}
function UploadDialog({
  events,
  onClose,
  load,
  notify,
  initialEvent,
  configured,
}) {
  const [files, setFiles] = useState([]),
    [eventId, setEventId] = useState(initialEvent),
    [date, setDate] = useState(
      events.find((e) => e.id === initialEvent)?.date || "",
    ),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [drag, setDrag] = useState(false);
  const input = useRef();
  const addFiles = (list) => {
    const valid = [...list].filter(
      (f) => /\.(jpe?g|png|webp)$/i.test(f.name) && f.size <= 25 * 1024 ** 2,
    );
    if (valid.length !== list.length)
      notify("部分文件被跳过：支持 JPG、PNG、WebP，每张不超过 25 MB", "error");
    setFiles((prev) =>
      [...prev, ...valid]
        .filter(
          (f, i, a) =>
            a.findIndex(
              (g) =>
                g.name === f.name &&
                g.size === f.size &&
                g.lastModified === f.lastModified,
            ) === i,
        )
        .slice(0, 100),
    );
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    let added = 0,
      duplicates = 0,
      errors = 0;
    try {
      for (let i = 0; i < files.length; i += 10) {
        const form = new FormData();
        files.slice(i, i + 10).forEach((f) => form.append("photos", f));
        if (eventId) form.append("eventId", eventId);
        if (date) form.append("date", date);
        const result = await api("/photos", { method: "POST", body: form });
        added += result.added;
        duplicates += result.duplicates;
        const failed = result.results.filter((r) => r.error);
        errors += failed.length;
        if (failed.length) notify(failed[0].error, "error");
        setProgress(Math.min(i + 10, files.length));
      }
      await load();
      notify(
        `已归档 ${added} 张照片${duplicates ? `，跳过 ${duplicates} 张重复照片` : ""}${errors ? `，${errors} 张失败` : ""}`,
        errors ? "error" : "success",
      );
      onClose();
    } catch (e) {
      await load();
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="把这次出发，收进相册" onClose={() => !busy && onClose()}>
      <form onSubmit={submit}>
        <p className="dialog-description">
          原图完整保存，自动生成轻量预览。
          {configured
            ? "将写入已配置的网盘同步目录。"
            : "先存到本机，稍后可连接网盘目录。"}
        </p>
        <input
          type="file"
          ref={input}
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy}
          className={"drop-zone " + (drag ? "dragging" : "")}
          onClick={() => input.current.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <span>
            <Upload size={27} />
          </span>
          <b>
            {files.length
              ? `已选择 ${files.length} 张照片`
              : "拖拽照片到这里，或点击选择"}
          </b>
          <small>JPG / PNG / WebP · 单张最大 25 MB · 最多 100 张</small>
        </button>
        {files.length > 0 && (
          <div className="upload-list">
            {files.map((f, i) => (
              <div key={f.name + i}>
                <Images size={15} />
                <span>{f.name}</span>
                <small>{bytes(f.size)}</small>
                <IconButton
                  type="button"
                  disabled={busy}
                  icon={X}
                  label={"移除" + f.name}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                />
              </div>
            ))}
          </div>
        )}
        <div className="form-row">
          <label>
            所属活动
            <select
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                setDate(
                  events.find((ev) => ev.id === e.target.value)?.date || "",
                );
              }}
            >
              <option value="">暂不归入活动</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            拍摄日期
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <p className="field-hint">
          不填写日期时，优先读取照片 EXIF
          拍摄时间；无拍摄时间则使用上传日期。重复原图会自动跳过。
        </p>
        {busy && (
          <div className="upload-progress">
            <progress value={progress} max={files.length} />
            <span>
              已处理 {progress} / {files.length} 张
            </span>
          </div>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            disabled={busy}
            className="button button-outline"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-dark"
            disabled={!files.length || busy}
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Upload size={17} />
            )}{" "}
            {busy
              ? "正在归档…"
              : `开始归档${files.length ? " · " + files.length + " 张" : ""}`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function EventDialog({ event, onClose, load, notify }) {
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api(event ? "/events/" + event.id : "/events", {
        method: event ? "PATCH" : "POST",
        body: Object.fromEntries(f),
      });
      await load();
      notify(event ? "活动信息已更新" : "活动已创建，可以上传照片了");
      onClose();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={event ? "编辑活动" : "记录一场新的出发"} onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          活动名称
          <input
            name="title"
            autoFocus
            required
            maxLength={120}
            placeholder="例如：秋日环湖 · 一起跑过十公里"
            defaultValue={event?.title}
          />
        </label>
        <div className="form-row">
          <label>
            活动日期
            <input
              name="date"
              type="date"
              required
              defaultValue={event?.date || today()}
            />
          </label>
          <label>
            集合地点
            <input
              name="location"
              maxLength={200}
              placeholder="例如：西湖 · 苏堤"
              defaultValue={event?.location}
            />
          </label>
        </div>
        <label>
          活动记忆
          <textarea
            name="description"
            maxLength={2000}
            rows={3}
            placeholder="写下天气、路线，或那个难忘的瞬间…"
            defaultValue={event?.description}
          />
        </label>
        <div className="dialog-actions">
          <button
            type="button"
            className="button button-outline"
            onClick={onClose}
          >
            取消
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            保存活动
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function TagDialog({ ids, events, photos, onClose, patch }) {
  const first = ids.length === 1 ? photos.find((p) => p.id === ids[0]) : null;
  const [eventId, setEventId] = useState(first?.eventId || ""),
    [date, setDate] = useState(first?.date || ""),
    [tags, setTags] = useState(first?.tags.join("，") || ""),
    [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const changes = {};
    if (eventId) changes.eventId = eventId === "none" ? null : eventId;
    if (date) changes.date = date;
    if (tags.trim() || first)
      changes.tags = tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
    const ok = await patch(ids, changes, "照片标记已保存");
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Dialog title={`标记 ${ids.length} 张照片`} onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          所属活动
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">保持当前活动</option>
            <option value="none">移出活动</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          拍摄日期
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          照片标签
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="例如：合影，冲线，十公里"
          />
        </label>
        <p className="field-hint">
          标签用逗号分隔。批量填写标签会替换所选照片的标签；日期、活动留空则保留原值。标记不会移动原文件。
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="button button-outline"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-dark"
            disabled={busy || (!eventId && !date && !tags.trim() && !first)}
          >
            <Check size={16} />
            保存标记
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function RenameDialog({ person, onClose, load, notify }) {
  const [name, setName] = useState(person.name),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title="给这个面孔一个名字" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/people/" + person.id, {
              method: "PATCH",
              body: { name },
            });
            await load();
            notify("成员名字已保存");
            onClose();
          } catch (e) {
            notify(e.message, "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          成员姓名
          <input
            value={name}
            autoFocus
            maxLength={50}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button className="button button-dark" disabled={busy}>
            <Check size={16} />
            保存名字
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function MergeDialog({ person, people, onClose, load, notify }) {
  const [to, setTo] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title="合并同一位跑友" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/people/merge", {
              method: "POST",
              body: { from: person.id, to },
            });
            await load();
            notify("分组已合并");
            onClose();
          } catch (e) {
            notify(e.message, "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="dialog-description">
          将「{person.name}」的照片合并到以下分组。合并后使用目标分组的名字。
        </p>
        <label>
          目标分组
          <select value={to} required onChange={(e) => setTo(e.target.value)}>
            <option value="">选择同一位成员</option>
            {people
              .filter((p) => p.id !== person.id)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name} · {p.photoCount} 张
                </option>
              ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button
            type="button"
            className="button button-outline"
            onClick={onClose}
          >
            取消
          </button>
          <button className="button button-dark" disabled={!to || busy}>
            <Merge size={16} />
            合并分组
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function Storage({ status, scan, scanBusy, load, notify }) {
  const [folder, setFolder] = useState(status?.root || ""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setFolder(status?.root || "");
  }, [status?.root]);
  return (
    <div className="storage-page">
      <div className="storage-intro">
        <div className="drive-icon">
          <Cloud size={36} />
        </div>
        <div>
          <span className="eyebrow">WESTLAKE DRIVE</span>
          <h2>学校办公网盘</h2>
          <p>通过 Windows 可直接读写的目录归档原图。</p>
        </div>
        <span
          className={
            "connection-pill " + (status?.configured ? "connected" : "")
          }
        >
          {status?.configured ? "目录已配置" : "尚未配置"}
        </span>
      </div>
      <div className="storage-columns">
        <section className="panel">
          <h3>
            <FolderOpen size={19} />
            原图存储目录
          </h3>
          <p>
            选择实际可读写的照片文件夹，也支持挂载的 NAS 或 SMB 路径。
            网盘网页地址和客户端内部缓存目录不能作为照片路径。
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/settings", {
                  method: "PATCH",
                  body: { root: folder },
                });
                await load();
                notify("存储目录已保存");
              } catch (e) {
                notify(e.message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              本机目录路径
              <input
                value={folder}
                required
                onChange={(e) => setFolder(e.target.value)}
                placeholder="D:\WestlakeDrive\跑团照片"
              />
            </label>
            <p className="field-hint">
              修改目录后，新上传的原图写入新位置；已有照片继续引用原位置。索引和人脸分组保存在本机
              data 目录。
            </p>
            <button className="button button-dark" disabled={busy}>
              <Link size={16} />
              {busy ? "正在检查…" : "保存并检查目录"}
            </button>
          </form>
          <div className="directory-state">
            <span
              className={status?.accessible ? "state-icon good" : "state-icon"}
            >
              {status?.accessible ? (
                <CheckCircle2 size={19} />
              ) : (
                <AlertCircle size={19} />
              )}
            </span>
            <div>
              <b>{status?.accessible ? "目录可读取" : "目录不可读取"}</b>
              <p>云端同步进度请在 WestlakeDrive 客户端查看。</p>
            </div>
          </div>
        </section>
        <section className="panel sync-panel">
          <h3>
            <RotateCcw size={19} />
            导入已有照片
          </h3>
          <p>
            扫描当前目录和子文件夹，保留原文件位置，自动跳过内容相同的照片。
          </p>
          <div className="scan-illustration">
            <FolderOpen size={42} />
            <span />
            <Images size={30} />
          </div>
          <button
            className="button button-outline"
            disabled={scanBusy || !status?.accessible}
            onClick={scan}
          >
            {scanBusy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <RotateCcw size={16} />
            )}{" "}
            {scanBusy ? "正在扫描目录…" : "扫描并导入照片"}
          </button>
          <small>支持 YYYY-MM-DD_活动名称 目录，自动识别日期和活动。</small>
        </section>
      </div>
      <div className="storage-metrics">
        <div>
          <Images size={20} />
          <span>
            已归档原图
            <b>
              {status?.count || 0}
              <small> 张</small>
            </b>
          </span>
        </div>
        <div>
          <HardDrive size={20} />
          <span>
            原图总大小<b>{bytes(status?.bytes || 0)}</b>
          </span>
        </div>
        <div>
          <ScanFace size={20} />
          <span>
            人脸分析<b>本机浏览器</b>
          </span>
        </div>
      </div>
      <section className="connection-guide">
        <h3>第一次连接？三步就好。</h3>
        <div>
          <article>
            <span>01</span>
            <h4>登录学校网盘</h4>
            <p>安装并登录 WestlakeDrive Windows 客户端，使用学校门户账号。</p>
            <a
              href="https://pan.westlake.edu.cn/"
              target="_blank"
              rel="noreferrer"
            >
              打开办公网盘
              <ExternalLink size={13} />
            </a>
          </article>
          <article>
            <span>02</span>
            <h4>准备照片目录</h4>
            <p>
              在可读写的个人文档或跑团文档库创建文件夹，确保原文件已下载到本机。
            </p>
          </article>
          <article>
            <span>03</span>
            <h4>保存路径并导入</h4>
            <p>填入实际目录路径。新照片自动写入目录，已有照片通过扫描导入。</p>
          </article>
        </div>
        <p className="guide-note">
          手册未提供开放 API 或 WebDAV
          文档；当前通过同步目录接入。网盘权限与云端同步由学校客户端管理。
        </p>
      </section>
    </div>
  );
}
function PhotoDetail({
  photo,
  onClose,
  patch,
  onTag,
  onTrash,
  onNext,
  canEdit,
}) {
  const ref = useRef();
  useEffect(() => {
    ref.current.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photo.id]);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      className={"lightbox " + (canEdit ? "" : "viewer-detail")}
      role="dialog"
      aria-modal="true"
      aria-label="照片详情"
    >
      <div className="lightbox-stage">
        <div className="lightbox-top">
          <span>
            <Camera size={17} />
            {photo.name}
          </span>
          <IconButton icon={X} label="关闭照片" onClick={onClose} />
        </div>
        <button
          className="photo-prev"
          aria-label="上一张"
          onClick={() => onNext(-1)}
        >
          <ArrowLeft size={22} />
        </button>
        {broken ? (
          <div className="photo-error">
            <AlertCircle />
            <p>原图暂时不可读取，请检查网盘同步。</p>
          </div>
        ) : (
          <img
            className="full-photo"
            src={photo.url}
            alt={photo.name}
            onError={() => setBroken(true)}
          />
        )}
        <button
          className="photo-next"
          aria-label="下一张"
          onClick={() => onNext(1)}
        >
          <ArrowRight size={22} />
        </button>
        <span className="lightbox-tip">← → 切换照片 · Esc 关闭</span>
      </div>
      <aside className="photo-details">
        <span className="eyebrow">THE MOMENT</span>
        <h2>{photo.eventTitle?.split(" · ")[0] || "奔跑的瞬间"}</h2>
        <span className="detail-date">{formatDate(photo.date)}</span>
        <div className="detail-actions">
          <a
            className="button button-dark"
            href={"/api/photos/" + photo.id + "/download"}
            download
          >
            <Download size={16} />
            下载原图
          </a>
          <IconButton
            icon={Heart}
            label={photo.favorite ? "取消收藏" : "收藏照片"}
            className={photo.favorite ? "favorite-active" : ""}
            onClick={() => patch([photo.id], { favorite: !photo.favorite })}
          />
        </div>
        <div className="detail-section">
          <h3>照片信息</h3>
          <dl>
            <dt>活动</dt>
            <dd>{photo.eventTitle || "未归入活动"}</dd>
            <dt>地点</dt>
            <dd>{photo.location || "未标记"}</dd>
            <dt>尺寸</dt>
            <dd>
              {photo.width} × {photo.height}
            </dd>
            <dt>文件大小</dt>
            <dd>{photo.demo ? "示例图片" : bytes(photo.size)}</dd>
            <dt>来源</dt>
            <dd>{photo.demo ? "Unsplash 示例" : "原图档案"}</dd>
          </dl>
        </div>
        <div className="detail-section">
          <h3>
            照片标签
            <button onClick={onTag}>
              <Plus size={15} />
              编辑
            </button>
          </h3>
          <div className="tag-list">
            {photo.tags.length ? (
              photo.tags.map((t) => <span key={t}>{t}</span>)
            ) : (
              <p>给照片添加一个关键词</p>
            )}
          </div>
        </div>
        <div className="detail-section">
          <h3>照片中的跑友</h3>
          {photo.people.length ? (
            photo.people.map((p) => (
              <div className="detail-person" key={p.id}>
                <Users size={15} />
                {p.name}
              </div>
            ))
          ) : (
            <p className="muted">
              {photo.demo
                ? "上传真实照片后可分析面孔"
                : photo.analyzed
                  ? "这张照片未检测到清晰人脸"
                  : "在「跑友面孔」中开始人脸分组"}
            </p>
          )}
        </div>
        <button
          className="detail-trash"
          onClick={
            photo.trash
              ? () => patch([photo.id], { trash: false }, "照片已恢复")
              : onTrash
          }
        >
          {photo.trash ? <RotateCcw size={16} /> : <Trash2 size={16} />}{" "}
          {photo.trash ? "恢复照片" : "移入回收站"}
        </button>
      </aside>
    </dialog>
  );
}
function Login({ onSuccess }) {
  const [value, setValue] = useState(""),
    [error, setError] = useState("");
  return (
    <div className="login-overlay">
      <div className="login-card">
        <span className="brand-mark">
          <Camera size={28} />
        </span>
        <h1>欢迎回到拾光</h1>
        <p>输入访问口令，打开跑团共同的记忆。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/login", { method: "POST", body: { token: value } });
              onSuccess();
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <label>
            访问口令
            <input
              autoFocus
              type="password"
              value={value}
              required
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="button button-dark">打开照片库</button>
        </form>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
