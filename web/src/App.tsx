import React, { useState, useEffect } from 'react';
import { 
  Terminal, 
  Settings, 
  Play, 
  RefreshCw, 
  FileText, 
  CheckCircle, 
  ArrowRight, 
  Copy, 
  Download, 
  Database, 
  Network, 
  Radio, 
  BookOpen, 
  Plus, 
  Trash2, 
  ExternalLink, 
  MessageSquare, 
  Sparkles, 
  Info,
  Menu,
  ChevronLeft,
  ChevronRight,
  Search,
  Bell,
  Sun,
  Moon,
  User,
  LogOut,
  Shield,
  Key,
  FileCode,
  Check,
  Cpu,
  Laptop,
  HelpCircle,
  Command,
  Layers,
  ChevronDown,
  Clock,
  Send,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { pythonFiles, ProjectFile } from './codebaseData';

// Types for Simulator State
interface MockCourse {
  id: string;
  name: string;
  section: string;
  teacher: string;
  announcements: Array<{ id: string; text: string; updateTime: string; materials?: any[] }>;
  coursework: Array<{ id: string; title: string; description: string; points: number; dueDate: string; updateTime: string }>;
}

interface MockChannel {
  id: string;
  name: string;
}

interface SimulatedLink {
  id: number;
  guildId: number;
  courseId: string;
  channelId: string;
  lastSyncAnnouncement: string | null;
  lastSyncCoursework: string | null;
  isActive: boolean;
}

interface SimulatedPostedAnnouncement {
  id: number;
  announcementId: string;
  courseId: string;
  guildId: number;
  postedAt: string;
}

interface DiscordMessage {
  id: string;
  author: string;
  avatarColor: string;
  isBot: boolean;
  content?: string;
  embed?: {
    title: string;
    description: string;
    color: string;
    url?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: string;
  };
  timestamp: string;
}

export default function App() {
  // Navigation tabs (shadcn-admin-panel side menus)
  const [activeTab, setActiveTab] = useState<'overview' | 'commands' | 'sandbox' | 'explorer' | 'configurator'>('overview');
  
  // Sidebar State (Collapsible)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  
  // Theme State (Light / Dark theme simulation)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Interactive drop-down controls
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState<boolean>(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Code Explorer state
  const [selectedFile, setSelectedFile] = useState<ProjectFile>(pythonFiles[0]);
  const [copiedFile, setCopiedFile] = useState<boolean>(false);
  
  // Configurator state
  const [botToken, setBotToken] = useState<string>('MTE5Mjg0NzU3Njk0MTIzNjQ4MA.Gx9Z3d.discord-token-signature');
  const [botEnabled, setBotEnabled] = useState<boolean>(true);
  const [syncInterval, setSyncInterval] = useState<number>(10);
  const [dbUrl, setDbUrl] = useState<string>('sqlite+aiosqlite:////app/data/classroom_sync.db');
  const [credsFile, setCredsFile] = useState<string>('/app/credentials/client_secret.json');
  const [tokenFile, setTokenFile] = useState<string>('/app/credentials/token.json');
  const [logLevel, setLogLevel] = useState<string>('INFO');
  const [copiedEnv, setCopiedEnv] = useState<boolean>(false);

  // SIMULATOR STATE
  const [simulateCourses, setSimulateCourses] = useState<MockCourse[]>([
    {
      id: "5984729110",
      name: "Algebra II & Trigonometry",
      section: "Period 3",
      teacher: "Prof. Sarah Jenkins",
      announcements: [
        {
          id: "ann_01",
          text: "Hi class! Just a heads-up that we will be reviewing the quadratic formula quiz on Wednesday. Please have your practice homework sheets ready.",
          updateTime: "2026-06-08T08:00:00Z",
          materials: [{ type: "drive", title: "Practice_Formula_Sheet.pdf", url: "#" }]
        }
      ],
      coursework: [
        {
          id: "cw_01",
          title: "Trigonometric Identities Quiz prep",
          description: "Complete exercises 1 to 14 on page 142. Submit a photo or scanned PDF of your working solutions.",
          points: 50,
          dueDate: "2026-06-15 at 23:59 UTC",
          updateTime: "2026-06-08T08:20:00Z"
        }
      ]
    },
    {
      id: "8749204918",
      name: "Introduction to Thermal Physics",
      section: "Period 5",
      teacher: "Dr. Marcus Vance",
      announcements: [
        {
          id: "ann_02",
          text: "Lecture notes on Thermodynamics laws have been uploaded. Watch the connected YouTube video on heat conversions before tomorrow's class.",
          updateTime: "2026-06-08T09:15:00Z",
          materials: [{ type: "youtube", title: "Thermodynamics laws explained", url: "#" }]
        }
      ],
      coursework: [
        {
          id: "cw_02",
          title: "Lab Report 3: Specific Heat Capacity",
          description: "Writeup detailing laboratory findings. Follow standard scientific formats detailing errors margins calculations.",
          points: 100,
          dueDate: "2026-06-12 at 18:00 UTC",
          updateTime: "2026-06-08T09:30:00Z"
        }
      ]
    },
    {
      id: "3049184729",
      name: "Modern World History 101",
      section: "Period 1",
      teacher: "Mr. Arthur Pendelton",
      announcements: [
        {
          id: "ann_03",
          text: "Reminder: Review chapters 8 and 9 on the industrial revolution for tomorrow's classroom discussion.",
          updateTime: "2026-06-07T14:00:00Z"
        }
      ],
      coursework: [
        {
          id: "cw_03",
          title: "The Industrial Revolution Reflection Essay",
          description: "Write an 800-word critical analysis on how industrialization shifted labor distributions.",
          points: 80,
          dueDate: "2026-06-20 at 22:00 UTC",
          updateTime: "2026-06-07T15:00:00Z"
        }
      ]
    }
  ]);

  const [simulateChannels] = useState<MockChannel[]>([
    { id: "1", name: "announcements" },
    { id: "2", name: "homework-assignments" },
    { id: "3", name: "general" }
  ]);

  const [selectedSimCourse, setSelectedSimCourse] = useState<string>("5984729110");
  const [selectedSimChannel, setSelectedSimChannel] = useState<string>("1");
  const [activeChannelId, setActiveChannelId] = useState<string>("1");
  
  // SQLite DB tables state
  const [dbLinks, setDbLinks] = useState<SimulatedLink[]>([
    { 
      id: 1, 
      guildId: 981240958102, 
      courseId: "5984729110", 
      channelId: "1", 
      lastSyncAnnouncement: "2026-06-08T08:00:00Z", 
      lastSyncCoursework: "2026-06-08T08:20:00Z", 
      isActive: true 
    }
  ]);
  const [dbPostedRecords, setDbPostedRecords] = useState<SimulatedPostedAnnouncement[]>([
    { id: 1, announcementId: "ann_01", courseId: "5984729110", guildId: 981240958102, postedAt: "2026-06-08T08:05:00Z" },
    { id: 2, announcementId: "cw_01", courseId: "5984729110", guildId: 981240958102, postedAt: "2026-06-08T08:25:00Z" }
  ]);

  // Simulated Discord post feed
  const [discordMessages, setDiscordMessages] = useState<DiscordMessage[]>([
    {
      id: "m_init",
      author: "Classroom Bot",
      avatarColor: "bg-emerald-600 dark:bg-emerald-700",
      isBot: true,
      content: "👋 **Classroom Sync Bot initialized successfully.** Background scheduler monitoring active courses.",
      timestamp: "Today at 08:30"
    },
    {
      id: "m_init_ann",
      author: "Classroom Bot",
      avatarColor: "bg-emerald-600 dark:bg-emerald-700",
      isBot: true,
      embed: {
        title: "📢 New Announcement • Algebra II & Trigonometry",
        description: "Hi class! Just a heads-up that we will be reviewing the quadratic formula quiz on Wednesday. Please have your practice homework sheets ready.",
        color: "emerald",
        url: "#",
        fields: [
          { name: "Attachments & Materials", value: "📁 [Drive: Practice_Formula_Sheet.pdf](#)" }
        ],
        footer: "Synced from Google Classroom • Posted: 2026-06-08T08:00:00Z"
      },
      timestamp: "Today at 08:31"
    }
  ]);

  // Bidirectional Posting Modal Simulator State
  const [showPostModal, setShowPostModal] = useState<boolean>(false);
  const [modalCourseId, setModalCourseId] = useState<string>("5984729110");
  const [modalTitle, setModalTitle] = useState<string>('');
  const [modalDescription, setModalDescription] = useState<string>('');

  // Auto poll notifications counter
  const [notification, setNotification] = useState<string | null>(null);

  // Simulated Live Bot Activity logs list (as notifications inside top-bar)
  const [notificationFeed, setNotificationFeed] = useState<Array<{ id: number; message: string; time: string; type: 'success' | 'info' | 'warn' }>>([
    { id: 1, message: "Bot sync schedulers armed (Interval: 10m)", time: "08:30", type: 'success' },
    { id: 2, message: "Authorized classroom api - 3 active scopes valid", time: "08:30", type: 'success' },
    { id: 3, message: "Polling loop completed. Posted (1) announcement.", time: "08:31", type: 'info' }
  ]);

  // Generate .env file contents dynamically
  const generatedEnv = `# Discord Bot Secrets
# Paste your Bot Token from the Discord Developer Portal
DISCORD_BOT_TOKEN="${botToken}"

# Set false if you only want the container to stay up without connecting to Discord
BOT_ENABLED=${botEnabled}

# Sync Configuration (interval in minutes, default is 10)
SYNC_INTERVAL_MINUTES=${syncInterval}

# Database URI (SQLite used inside the container volume)
DATABASE_URL="${dbUrl}"

# Google Credentials Paths
# These are mounted within the docker container at /app/credentials/
GOOGLE_CLIENT_SECRET_FILE="${credsFile}"
GOOGLE_TOKEN_FILE="${tokenFile}"

# Logging Level (INFO, DEBUG, WARNING, ERROR)
LOG_LEVEL="${logLevel}"`;

  const deploymentHighlights = [
    {
      title: 'Discord bot permissions',
      body: 'Create a bot in the Discord Developer Portal, enable the bot scope plus applications.commands, then invite it with Send Messages, Embed Links, View Channel, and Read Message History permissions.'
    },
    {
      title: 'Google Classroom API setup',
      body: 'Enable Google Classroom API in Google Cloud, configure the OAuth consent screen, add the teacher account as a test user, and download a Desktop App OAuth client as client_secret.json.'
    },
    {
      title: 'Runtime layout',
      body: 'The Python bot reads .env values, mounts /app/credentials for OAuth files, and persists sync cursors in SQLite so announcements and coursework are not reposted.'
    }
  ];

  const deploymentSteps = [
    {
      step: '1',
      title: 'Prepare the server workspace',
      description: 'Create a clean directory for the compose stack and mount points for credentials and SQLite data.',
      command: 'mkdir -p /opt/classroom-bot/{credentials,data,web,docker} && cd /opt/classroom-bot'
    },
    {
      step: '2',
      title: 'Place bot files and compose files',
      description: 'Copy this repository to the VM so the flat monorepo layout (src/, web/, docker/) is available to Docker Compose.',
      command: 'git clone <your-repo-url> /opt/classroom-bot && cd /opt/classroom-bot'
    },
    {
      step: '3',
      title: 'Create Google OAuth files',
      description: 'Put client_secret.json and token.json into credentials/. Generate token.json once on a host machine with browser access if you do not already have it.',
      command: 'python src/scripts/setup_google_auth.py'
    },
    {
      step: '4',
      title: 'Fill the .env file',
      description: 'Use the Env Parameters panel to generate .env, then place it at the repo root with the real Discord token, BOT_ENABLED=true, OAuth paths, and SQLite path.',
      command: 'cp .env.bot.example .env'
    },
    {
      step: '5',
      title: 'Start and verify the stack',
      description: 'Boot the development compose stack, check the bot log for OAuth success, then verify slash commands and manual sync inside Discord.',
      command: 'docker compose -f docker/compose.yml --profile dev up -d --build'
    }
  ];

  const deploymentChecks = [
    'Google Cloud Console: enable Classroom API and add the teacher Google account to OAuth test users.',
    'Discord Developer Portal: copy the bot token and invite the application with bot plus applications.commands scopes.',
    'Credentials directory: credentials/client_secret.json and credentials/token.json must both exist.',
    'Environment file: repo-root .env must include DISCORD_BOT_TOKEN, BOT_ENABLED, DATABASE_URL, GOOGLE_CLIENT_SECRET_FILE, and GOOGLE_TOKEN_FILE.'
  ];

  const copyToClipboard = (text: string, isEnv: boolean) => {
    navigator.clipboard.writeText(text);
    if (isEnv) {
      setCopiedEnv(true);
      setTimeout(() => setCopiedEnv(false), 2000);
    } else {
      setCopiedFile(true);
      setTimeout(() => setCopiedFile(false), 2000);
    }
  };

  useEffect(() => {
    // If selecting tab or file, set select file
    if (!selectedFile) {
      setSelectedFile(pythonFiles[0]);
    }
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Simulator core functions
  const handleCreateLink = () => {
    // Verify duplicate link
    const exists = dbLinks.find(link => link.courseId === selectedSimCourse && link.channelId === selectedSimChannel);
    if (exists) {
      triggerNotification("⚠️ Course is already linked to this channel!");
      return;
    }

    const newLink: SimulatedLink = {
      id: dbLinks.length + 1,
      guildId: 981240958102,
      courseId: selectedSimCourse,
      channelId: selectedSimChannel,
      lastSyncAnnouncement: null,
      lastSyncCoursework: null,
      isActive: true
    };

    setDbLinks([...dbLinks, newLink]);
    
    // Add Discord notification
    const linkedCourse = simulateCourses.find(c => c.id === selectedSimCourse);
    const targetChan = simulateChannels.find(ch => ch.id === selectedSimChannel);
    
    const newMsg: DiscordMessage = {
      id: `m_link_${Date.now()}`,
      author: "System",
      avatarColor: "bg-slate-600 dark:bg-slate-700",
      isBot: false,
      content: `⚙️ **Administrator** manually linked Classroom Course **${linkedCourse?.name}** (\`${linkedCourse?.id}\`) to Discord channel **#${targetChan?.name}**.`,
      timestamp: "Just Now"
    };

    setDiscordMessages(prev => [...prev, newMsg]);
    
    // Add to activity system logs
    setNotificationFeed(prev => [
      { id: Date.now(), message: `Mapped course '${linkedCourse?.name}' to info channel #${targetChan?.name}`, time: "Now", type: 'success' },
      ...prev
    ]);

    triggerNotification(`🔗 Linked "${linkedCourse?.name}" with #${targetChan?.name}!`);
  };

  const handleUnlink = (id: number) => {
    const unlinked = dbLinks.find(l => l.id === id);
    if (!unlinked) return;
    
    const linkedCourse = simulateCourses.find(c => c.id === unlinked.courseId);
    
    setDbLinks(dbLinks.filter(l => l.id !== id));
    
    const newMsg: DiscordMessage = {
      id: `m_link_${Date.now()}`,
      author: "System",
      avatarColor: "bg-slate-600 dark:bg-slate-700",
      isBot: false,
      content: `🗑️ **Administrator** unlinked course **${linkedCourse?.name}** (` + "`" + unlinked.courseId + "`" + `) from integrations catalog.`,
      timestamp: "Just Now"
    };
    
    setDiscordMessages(prev => [...prev, newMsg]);
  };

  // Trigger simulated background polling sequence
  const handleRunSync = () => {
    let syncCount = 0;
    const newDiscMessages: DiscordMessage[] = [];
    const newPostRecords: SimulatedPostedAnnouncement[] = [];
    const updatedLinks = [...dbLinks];

    // Read active mappings
    updatedLinks.forEach(link => {
      const course = simulateCourses.find(c => c.id === link.courseId);
      if (!course || !link.isActive) return;

      const targetChan = simulateChannels.find(c => c.id === link.channelId);
      if (!targetChan) return;

      // Check Announcements list
      course.announcements.forEach(ann => {
        // Deduplicate
        const isPosted = dbPostedRecords.some(r => r.announcementId === ann.id) || 
                         newPostRecords.some(r => r.announcementId === ann.id);
        
        const timestampPassed = link.lastSyncAnnouncement ? ann.updateTime > link.lastSyncAnnouncement : true;

        if (timestampPassed && !isPosted) {
          syncCount++;
          // Register item
          newPostRecords.push({
            id: dbPostedRecords.length + newPostRecords.length + 1,
            announcementId: ann.id,
            courseId: course.id,
            guildId: 981240958102,
            postedAt: new Date().toISOString()
          });

          // Build message
          newDiscMessages.push({
            id: `msg_sync_ann_${ann.id}_${Date.now()}`,
            author: "Classroom Bot",
            avatarColor: "bg-emerald-600 dark:bg-emerald-700",
            isBot: true,
            content: "",
            embed: {
              title: `📢 New Announcement • ${course.name}`,
              description: ann.text,
              color: "emerald",
              url: "#",
              fields: ann.materials ? [
                { 
                  name: "Attachments & Materials", 
                  value: ann.materials.map(m => m.type === "drive" ? `📁 [Drive: ${m.title}](#)` : `🎥 [YouTube: ${m.title}](#)`).join('\n') 
                }
              ] : undefined,
              footer: `Synced from Google Classroom • Posted: ${ann.updateTime.replace('Z', ' UTC')}`
            },
            timestamp: "Just Now"
          });

          // Update sync cursor
          link.lastSyncAnnouncement = ann.updateTime;
        }
      });

      // Check Coursework (Homework assignments)
      course.coursework.forEach(cw => {
        const isPosted = dbPostedRecords.some(r => r.announcementId === cw.id) || 
                         newPostRecords.some(r => r.announcementId === cw.id);
        
        const timestampPassed = link.lastSyncCoursework ? cw.updateTime > link.lastSyncCoursework : true;

        if (timestampPassed && !isPosted) {
          syncCount++;
          newPostRecords.push({
            id: dbPostedRecords.length + newPostRecords.length + 1,
            announcementId: cw.id,
            courseId: course.id,
            guildId: 981240958102,
            postedAt: new Date().toISOString()
          });

          newDiscMessages.push({
            id: `msg_sync_cw_${cw.id}_${Date.now()}`,
            author: "Classroom Bot",
            avatarColor: "bg-emerald-600 dark:bg-emerald-700",
            isBot: true,
            embed: {
              title: `📝 Coursework Assigned: ${cw.title}`,
              description: cw.description,
              color: "amber",
              url: "#",
              fields: [
                { name: "Class", value: course.name, inline: true },
                { name: "Grading", value: `${cw.points} points`, inline: true },
                { name: "📅 Due Date", value: `**${cw.dueDate}**`, inline: false }
              ],
              footer: `Synced from Google Classroom • Modified: ${cw.updateTime.replace('Z', ' UTC')}`
            },
            timestamp: "Just Now"
          });

          link.lastSyncCoursework = cw.updateTime;
        }
      });
    });

    if (syncCount > 0) {
      setDbLinks(updatedLinks);
      setDbPostedRecords([...dbPostedRecords, ...newPostRecords]);
      setDiscordMessages(prev => [...prev, ...newDiscMessages]);
      
      setNotificationFeed(prev => [
        { id: Date.now(), message: `Force synchronized scheduler. Pulled ${syncCount} new updates!`, time: "Now", type: 'success' },
        ...prev
      ]);

      triggerNotification(`🔄 Sync completed! Posted ${syncCount} new Classroom item(s) to Discord.`);
    } else {
      setNotificationFeed(prev => [
        { id: Date.now(), message: `Manual sync checkup completed (No new updates found).`, time: "Now", type: 'info' },
        ...prev
      ]);
      triggerNotification("ℹ️ Already up to date. No new updates found.");
    }
  };

  // Bidirectional Post Simulator
  const handleMockPostSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalTitle || !modalDescription) return;

    // 1. Create locally on Mock Classroom courses list
    const updatedCourses = simulateCourses.map(course => {
      if (course.id === modalCourseId) {
        const newAnnId = `ann_mock_${Date.now()}`;
        return {
          ...course,
          announcements: [
            {
              id: newAnnId,
              text: `**${modalTitle}**\n\n${modalDescription}`,
              updateTime: new Date().toISOString()
            },
            ...course.announcements
          ]
        };
      }
      return course;
    });

    setSimulateCourses(updatedCourses);
    setShowPostModal(false);
    
    const postedCourseName = simulateCourses.find(c => c.id === modalCourseId)?.name || "";
    const responseMsg: DiscordMessage = {
      id: `m_post_ok_${Date.now()}`,
      author: "Classroom Bot",
      avatarColor: "bg-emerald-600 dark:bg-emerald-700",
      isBot: true,
      content: `✅ **Announcement Created Successfully on Classroom!**\nCourse: **${postedCourseName}**\nHeading: *${modalTitle}*\n\nNote: The next scheduler background poll pass (or manually clicking **"Force Sync Poller"**) will distribute this announcement to linked chats ensuring idempotency.`,
      timestamp: "Just Now"
    };

    setDiscordMessages(prev => [...prev, responseMsg]);
    
    setNotificationFeed(prev => [
      { id: Date.now(), message: `New announcement posted to Google Classroom: '${modalTitle}'`, time: "Now", type: 'success' },
      ...prev
    ]);

    triggerNotification(`📬 Announcement sent back to Google Classroom for "${postedCourseName}"!`);

    setModalTitle('');
    setModalDescription('');
  };

  const triggerNotification = (text: string) => {
    setNotification(text);
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  const downloadEnvFile = () => {
    const element = document.createElement("a");
    const file = new Blob([generatedEnv], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = ".env";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Static items for search mechanism
  const searchMatches = [
    { name: "How to deploy (Docker)", tab: "overview", label: "Overview -> VM Deployment Guide" },
    { name: "/classroom courses link unlink Commands list", tab: "commands", label: "Commands Catalog" },
    { name: "Live Sandbox Simulation", tab: "sandbox", label: "Live Sandbox" },
    { name: ".env setup file explorer downloader", tab: "configurator", label: "Env Generator" },
    { name: "Codebase file explorer models database structure", tab: "explorer", label: "Python Codebase Explorer" }
  ];

  const filteredSearch = searchQuery 
    ? searchMatches.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : searchMatches;

  return (
    <div className={`min-h-screen font-sans antialiased transition-colors duration-200 
      ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}
    >
      {/* Toast Alert Banner */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: -50, scale: 0.95 }}
            animate={{ opacity: 1, y: 16, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-emerald-600 text-white font-medium px-5 py-3 rounded-xl shadow-lg border border-emerald-500 flex items-center space-x-3 text-sm"
          >
            <Sparkles className="w-5 h-5 flex-shrink-0 animate-pulse" />
            <span>{notification}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Outer Dashboard layout wrapper */}
      <div className="flex h-screen overflow-hidden">
        
        {/* DESKTOP SIDEBAR NAVIGATION (shadcn-admin-panel inspired) */}
        <aside className={`hidden md:flex flex-col flex-shrink-0 transition-all duration-300 z-30
          ${isSidebarCollapsed ? 'w-16' : 'w-64'} 
          ${theme === 'dark' ? 'bg-slate-900 border-r border-slate-800' : 'bg-white border-r border-slate-200 shadow-sm'}`}
        >
          {/* Sidebar Brand Header */}
          <div className={`p-4 flex items-center space-x-3 shrink-0 ${isSidebarCollapsed ? 'justify-center' : ''} border-b ${theme === 'dark' ? 'border-slate-800' : 'border-slate-100'}`}>
            <div className={`flex items-center justify-center shrink-0 w-9 h-9 rounded-lg bg-emerald-600/15 text-emerald-500 border border-emerald-500/20`}>
              <Network className="w-5 h-5" />
            </div>
            {!isSidebarCollapsed && (
              <div className="flex flex-col">
                <span className="font-bold text-sm tracking-tight leading-none text-emerald-500 truncate">Classroom Link</span>
                <span className={`text-[10px] mt-0.5 font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>v1.0 Admin Console</span>
              </div>
            )}
          </div>

          {/* Quick Context Switcher Indicator */}
          {!isSidebarCollapsed && (
            <div className={`mx-3 my-4 p-2.5 rounded-lg border flex items-center justify-between ${theme === 'dark' ? 'bg-slate-950/40 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center space-x-2 truncate">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <div className="text-left truncate">
                  <span className="block text-xs font-semibold leading-tight">Docker Node</span>
                  <span className="block text-[9px] text-slate-500 font-mono truncate">class-sync-bot-prod</span>
                </div>
              </div>
              <Cpu className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </div>
          )}

          {/* Sidebar Menu Scroll */}
          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
            
            {/* Menu Group 1: General Info */}
            <div className="space-y-1">
              {!isSidebarCollapsed && (
                <span className={`block px-3 text-[10px] font-semibold uppercase tracking-wider ${theme === 'dark' ? 'text-slate-500' : 'text-slate-600 font-bold'}`}>
                  Main Workspace
                </span>
              )}
              
              {/* Dashboard Guide */}
              <button 
                onClick={() => setActiveTab('overview')}
                className={`w-full flex items-center rounded-lg px-3 py-2.5 text-xs font-medium tracking-wide transition-all ${isSidebarCollapsed ? 'justify-center' : 'space-x-3'}
                  ${activeTab === 'overview' 
                    ? 'bg-emerald-600/10 text-emerald-500 border-l-2 border-emerald-500 font-semibold' 
                    : `text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-slate-100`}`}
              >
                <Layers className="w-4 h-4 shrink-0" />
                {!isSidebarCollapsed && <span>Dashboard Overview</span>}
              </button>

              {/* Bot Slash Commands */}
              <button 
                onClick={() => setActiveTab('commands')}
                className={`w-full flex items-center rounded-lg px-3 py-2.5 text-xs font-medium tracking-wide transition-all ${isSidebarCollapsed ? 'justify-center' : 'space-x-3'}
                  ${activeTab === 'commands' 
                    ? 'bg-emerald-600/10 text-emerald-500 border-l-2 border-emerald-500 font-semibold' 
                    : `text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-slate-100`}`}
              >
                <Command className="w-4 h-4 shrink-0" />
                {!isSidebarCollapsed && <span>Slash Commands</span>}
              </button>

              {/* Live Sandbox simulation */}
              <button 
                onClick={() => setActiveTab('sandbox')}
                className={`w-full flex items-center rounded-lg px-3 py-2.5 text-xs font-medium tracking-wide transition-all ${isSidebarCollapsed ? 'justify-center' : 'space-x-3'}
                  ${activeTab === 'sandbox' 
                    ? 'bg-emerald-600/10 text-emerald-500 border-l-2 border-emerald-500 font-semibold' 
                    : `text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-slate-100`}`}
              >
                <Play className="w-4 h-4 shrink-0" />
                {!isSidebarCollapsed && <span>Live Sandbox simulator</span>}
              </button>
            </div>

            {/* Menu Group 2: Developer Elements */}
            <div className="space-y-1">
              {!isSidebarCollapsed && (
                <span className={`block px-3 text-[10px] font-semibold uppercase tracking-wider ${theme === 'dark' ? 'text-slate-500' : 'text-slate-600 font-bold'}`}>
                  Developer Center
                </span>
              )}

              {/* Code Explorer file viewer */}
              <button 
                onClick={() => setActiveTab('explorer')}
                className={`w-full flex items-center rounded-lg px-3 py-2.5 text-xs font-medium tracking-wide transition-all ${isSidebarCollapsed ? 'justify-center' : 'space-x-3'}
                  ${activeTab === 'explorer' 
                    ? 'bg-emerald-600/10 text-emerald-500 border-l-2 border-emerald-500 font-semibold' 
                    : `text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-slate-100`}`}
              >
                <FileCode className="w-4 h-4 shrink-0" />
                {!isSidebarCollapsed && <span>Python Codebase</span>}
              </button>

              {/* Environment configurator */}
              <button 
                onClick={() => setActiveTab('configurator')}
                className={`w-full flex items-center rounded-lg px-3 py-2.5 text-xs font-medium tracking-wide transition-all ${isSidebarCollapsed ? 'justify-center' : 'space-x-3'}
                  ${activeTab === 'configurator' 
                    ? 'bg-emerald-600/10 text-emerald-500 border-l-2 border-emerald-500 font-semibold' 
                    : `text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-slate-100`}`}
              >
                <Settings className="w-4 h-4 shrink-0" />
                {!isSidebarCollapsed && <span>Env Parameters</span>}
              </button>
            </div>

            {/* Quick deployment stats info box */}
            {!isSidebarCollapsed && (
              <div className={`mt-auto p-3.5 rounded-lg border relative overflow-hidden ${theme === 'dark' ? 'bg-slate-950/20 border-slate-800/60' : 'bg-slate-50 border-slate-200'}`}>
                <span className="block text-[10px] uppercase font-mono tracking-wider text-slate-500 mb-1.5 font-bold">Deploy Specs</span>
                <span className="block text-xs font-medium mb-1">Status: <span className="text-emerald-500 font-bold font-mono">ONLINE</span></span>
                <span className="block text-[11px] text-slate-500">Daemon PID: 4019</span>
                <span className="block text-[11px] text-slate-500">SQLite DB links: {dbLinks.length} mappings</span>
                <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-full blur-xl pointer-events-none" />
              </div>
            )}
          </div>

          {/* Sidebar Footer User controls */}
          <div className={`p-3 border-t ${theme === 'dark' ? 'border-slate-800' : 'border-slate-100'} shrink-0 flex items-center justify-between`}>
            {!isSidebarCollapsed ? (
              <div className="flex items-center space-x-2.5 truncate">
                <div className="w-7.5 h-7.5 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-xs text-white uppercase select-none font-mono shrink-0">
                  K0
                </div>
                <div className="text-left truncate">
                  <span className={`block text-xs font-semibold leading-tight truncate ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>k026c1090</span>
                  <span className="block text-[10px] text-slate-500 truncate lowercase leading-tight">Administrator</span>
                </div>
              </div>
            ) : (
              <div className="mx-auto w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-xs text-white uppercase font-mono">
                K0
              </div>
            )}
            
            {/* Collapse toggle arrow */}
            <button 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className={`p-1.5 rounded text-slate-500 transition duration-150 ${isSidebarCollapsed ? 'mx-auto' : ''} ${theme === 'dark' ? 'hover:bg-slate-800/50 hover:text-slate-100' : 'hover:bg-slate-100 hover:text-slate-900'}`}
              title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              {isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
        </aside>

        {/* MOBILE SLIDE-IN SIDEBAR PANEL */}
        <AnimatePresence>
          {isMobileSidebarOpen && (
            <>
              <div 
                onClick={() => setIsMobileSidebarOpen(false)}
                className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-40 md:hidden"
              />
              <motion.aside 
                initial={{ x: -250 }}
                animate={{ x: 0 }}
                exit={{ x: -250 }}
                transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                className={`fixed top-0 bottom-0 left-0 w-64 z-50 flex flex-col md:hidden
                  ${theme === 'dark' ? 'bg-slate-900 border-r border-slate-800 text-white' : 'bg-white border-r border-slate-200 text-slate-900'}`}
              >
                <div className={`p-4 flex items-center justify-between border-b ${theme === 'dark' ? 'border-slate-800' : 'border-slate-150'}`}>
                  <div className="flex items-center space-x-3">
                    <div className="bg-emerald-600/10 text-emerald-500 p-2 rounded-lg">
                      <Network className="w-5 h-5 animate-pulse" />
                    </div>
                    <span className="font-bold text-sm tracking-tight">Classroom Sync Bot</span>
                  </div>
                  <button onClick={() => setIsMobileSidebarOpen(false)} className="p-1 rounded hover:bg-slate-800/40">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                  <div className="space-y-1">
                    <span className="block text-[10px] font-mono tracking-wider uppercase text-slate-500 px-3 mb-2">Main Workspace</span>
                    
                    <button 
                      onClick={() => { setActiveTab('overview'); setIsMobileSidebarOpen(false); }}
                      className={`w-full flex items-center space-x-3 rounded-lg px-3 py-2.5 text-xs font-semibold
                        ${activeTab === 'overview' ? 'bg-emerald-600/10 text-emerald-500 border-l-2 border-emerald-500' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/40'}`}
                    >
                      <Layers className="w-4 h-4" />
                      <span>Dashboard Overview</span>
                    </button>

                    <button 
                      onClick={() => { setActiveTab('commands'); setIsMobileSidebarOpen(false); }}
                      className={`w-full flex items-center space-x-3 rounded-lg px-3 py-2.5 text-xs font-semibold
                        ${activeTab === 'commands' ? 'bg-emerald-600/10 text-emerald-500 border-l-2 border-emerald-500' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/40'}`}
                    >
                      <Command className="w-4 h-4" />
                      <span>Slash Commands</span>
                    </button>

                    <button 
                      onClick={() => { setActiveTab('sandbox'); setIsMobileSidebarOpen(false); }}
                      className={`w-full flex items-center space-x-3 rounded-lg px-3 py-2.5 text-xs font-semibold
                        ${activeTab === 'sandbox' ? 'bg-emerald-600/10 text-emerald-500 border-l-2 border-emerald-500' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/40'}`}
                    >
                      <Play className="w-4 h-4" />
                      <span>Live Sandbox</span>
                    </button>
                  </div>

                  <div className="space-y-1">
                    <span className="block text-[10px] font-mono tracking-wider uppercase text-slate-500 px-3 mb-2">Developer Tools</span>

                    <button 
                      onClick={() => { setActiveTab('explorer'); setIsMobileSidebarOpen(false); }}
                      className={`w-full flex items-center space-x-3 rounded-lg px-3 py-2.5 text-xs font-semibold
                        ${activeTab === 'explorer' ? 'bg-emerald-600/10 text-emerald-500 border-l-2 border-emerald-500' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/40'}`}
                    >
                      <FileCode className="w-4 h-4" />
                      <span>Python Codebase</span>
                    </button>

                    <button 
                      onClick={() => { setActiveTab('configurator'); setIsMobileSidebarOpen(false); }}
                      className={`w-full flex items-center space-x-3 rounded-lg px-3 py-2.5 text-xs font-semibold
                        ${activeTab === 'configurator' ? 'bg-emerald-600/10 text-emerald-500 border-l-2 border-emerald-500' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/40'}`}
                    >
                      <Settings className="w-4 h-4" />
                      <span>Env Parameters</span>
                    </button>
                  </div>
                </div>

                <div className={`p-4 border-t ${theme === 'dark' ? 'border-slate-800' : 'border-slate-150'} flex items-center space-x-2.5`}>
                  <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-white uppercase text-xs">
                    K0
                  </div>
                  <div>
                    <span className="block text-xs font-semibold">k026c1090@g.neec.ac.jp</span>
                    <span className="block text-[10px] text-slate-500">Administrator</span>
                  </div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* MAIN BODY AREA (Header top + Content scroll) */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          
          {/* TOP PRIMARY HEADER (shadcn-admin-panel layout) */}
          <header className={`sticky top-0 z-20 flex h-14 items-center shrink-0 justify-between px-4 sm:px-6 border-b transition-colors
            ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200'}`}
          >
            {/* Sidebar toggle + Breadcrumbs */}
            <div className="flex items-center space-x-3">
              {/* Mobile Sidebar Hamburger */}
              <button 
                onClick={() => setIsMobileSidebarOpen(true)}
                className="md:hidden p-1.5 rounded-lg hover:bg-slate-800/20"
                title="Open Sidebar Menu"
              >
                <Menu className="w-4.5 h-4.5" />
              </button>

              {/* Breadcrumb tracking */}
              <div className="flex items-center space-x-1.5 text-xs font-medium">
                <span className="text-slate-500">Console</span>
                <span className="text-slate-400">/</span>
                {activeTab === 'overview' && (
                  <>
                    <span className="text-slate-500">Overview</span>
                    <span className="text-slate-400">/</span>
                    <span className="font-semibold text-emerald-500">Dashboard</span>
                  </>
                )}
                {activeTab === 'commands' && (
                  <>
                    <span className="text-slate-500">Slash Commands</span>
                    <span className="text-slate-400">/</span>
                    <span className="font-semibold text-emerald-500">API Catalog</span>
                  </>
                )}
                {activeTab === 'sandbox' && (
                  <>
                    <span className="text-slate-500">Live Services</span>
                    <span className="text-slate-400">/</span>
                    <span className="font-semibold text-emerald-500">Sandbox Simulator</span>
                  </>
                )}
                {activeTab === 'configurator' && (
                  <>
                    <span className="text-slate-500">Parameters</span>
                    <span className="text-slate-400">/</span>
                    <span className="font-semibold text-emerald-500">Env Config</span>
                  </>
                )}
                {activeTab === 'explorer' && (
                  <>
                    <span className="text-slate-500">Source files</span>
                    <span className="text-slate-400">/</span>
                    <span className="font-semibold text-emerald-500">Codebase IDE</span>
                  </>
                )}
              </div>
            </div>

            {/* Topbar Widgets */}
            <div className="flex items-center space-x-2">
              
              {/* Interactive Search Tool */}
              <div className="relative">
                <button
                  onClick={() => setIsSearchOpen(!isSearchOpen)}
                  className={`hidden sm:flex items-center space-x-2 text-left text-xs px-3 py-1.5 rounded-lg w-56 border transition duration-150
                    ${theme === 'dark' ? 'bg-slate-950/45 text-slate-400 border-slate-800 hover:border-slate-700 hover:bg-slate-950/30' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-100'}`}
                >
                  <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="truncate flex-1 text-slate-500 dark:text-slate-400">Search settings...</span>
                  <span className="text-[10px] bg-slate-300/40 dark:bg-slate-800/40 p-0.5 px-1 rounded font-mono shrink-0">⌘K</span>
                </button>
                
                {/* Search Dropdown Panel modal backdrop */}
                {isSearchOpen && (
                  <>
                    <div onClick={() => setIsSearchOpen(false)} className="fixed inset-0 z-30 pointer-events-auto" />
                    <div className={`absolute right-0 mt-2.5 w-64 rounded-xl shadow-xl border z-40 p-2 text-xs text-left
                      ${theme === 'dark' ? 'bg-slate-900 border-slate-800 shadow-slate-950/80 text-white' : 'bg-white border-slate-250 shadow-slate-200/50 text-slate-900'}`}
                    >
                      <div className="p-2 border-b border-slate-800/20 flex items-center space-x-1.5">
                        <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <input
                          type="text"
                          placeholder="Type query..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full bg-transparent text-xs focus:outline-none placeholder-slate-500 font-sans"
                          autoFocus
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto py-1">
                        {filteredSearch.map((item, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setActiveTab(item.tab as any);
                              setIsSearchOpen(false);
                            }}
                            className={`w-full text-left p-2 rounded hover:bg-emerald-600/10 hover:text-emerald-500 flex items-center justify-between text-[11px]`}
                          >
                            <span>{item.name}</span>
                            <span className="text-[9px] text-slate-500 uppercase">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Theme Toggle Button (interactable) */}
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className={`p-2 rounded-lg transition duration-150 ${theme === 'dark' ? 'hover:bg-slate-800/30 text-slate-400 hover:text-slate-100' : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'}`}
                title="Toggle visual style preset"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
              </button>

              {/* Bot Activity Logs Notifications Indicator Bell */}
              <div className="relative">
                <button
                  onClick={() => setIsNotificationOpen(!isNotificationOpen)}
                  className={`p-2 rounded-lg relative transition duration-150 ${theme === 'dark' ? 'hover:bg-slate-800/30 text-slate-400 hover:text-slate-100' : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'}`}
                  title="Show Live Bot System Alerts"
                >
                  <Bell className="w-4 h-4" />
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-500" />
                </button>

                {/* Notifications dropdown list */}
                {isNotificationOpen && (
                  <>
                    <div onClick={() => setIsNotificationOpen(false)} className="fixed inset-0 z-30 pointer-events-auto" />
                    <div className={`absolute right-0 mt-2.5 w-72 rounded-xl shadow-xl border z-40 p-3 text-xs text-left
                      ${theme === 'dark' ? 'bg-slate-900 border-slate-800 shadow-slate-950/80 text-white' : 'bg-white border-slate-250 shadow-slate-200/50 text-slate-900'}`}
                    >
                      <div className="flex items-center justify-between border-b pb-2 mb-2 border-slate-800/30">
                        <span className="font-semibold text-xs flex items-center space-x-1.5">
                          <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                          <span>Background Sync Monitor</span>
                        </span>
                        <span className="text-[10px] text-emerald-500 font-mono">3 Active alerts</span>
                      </div>
                      
                      <div className="space-y-2 max-h-64 overflow-y-auto py-1">
                        {notificationFeed.map((alert) => (
                          <div key={alert.id} className={`p-2 border rounded-lg space-y-1 ${theme === 'dark' ? 'bg-slate-950/30 border-slate-800/20' : 'bg-slate-50 border-slate-100'}`}>
                            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                              <span className={alert.type === 'success' ? 'text-emerald-500' : theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}>
                                {alert.type.toUpperCase()}
                              </span>
                              <span>{alert.time}</span>
                            </div>
                            <p className={`text-[11px] leading-tight ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>{alert.message}</p>
                          </div>
                        ))}
                      </div>
                      <div className="pt-2 border-t border-slate-800/20 flex justify-between">
                        <button 
                          onClick={() => { setActiveTab('sandbox'); setIsNotificationOpen(false); }} 
                          className="text-emerald-500 hover:underline text-[10px] font-semibold"
                        >
                          Launch Sandbox Viewer
                        </button>
                        <button 
                          onClick={() => setNotificationFeed([])} 
                          className="text-slate-500 hover:text-slate-705 dark:hover:text-slate-400 text-[10px]"
                        >
                          Clear log feed
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Vertical Divider */}
              <div className="w-px h-5 bg-slate-100/10 dark:bg-slate-800" />

              {/* Registered user email drop-down */}
              <div className="relative">
                <button
                  onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
                  className={`flex items-center space-x-2 p-1 pl-2.5 rounded-lg transition duration-150 ${theme === 'dark' ? 'hover:bg-slate-800/30' : 'hover:bg-slate-100'}`}
                  title="User controls profile list"
                >
                  <span className={`hidden sm:inline text-xs font-semibold font-mono ${theme === 'dark' ? 'text-slate-400 hover:text-slate-300' : 'text-slate-600 hover:text-slate-800'}`}>
                    k026c1090
                  </span>
                  <div className="w-7 h-7 rounded-full bg-emerald-600/10 text-emerald-500 border border-emerald-500/20 flex items-center justify-center font-bold text-xs">
                    K0
                  </div>
                </button>

                {/* Profile Modal panel list popup */}
                {isProfileDropdownOpen && (
                  <>
                    <div onClick={() => setIsProfileDropdownOpen(false)} className="fixed inset-0 z-30 pointer-events-auto" />
                    <div className={`absolute right-0 mt-2.5 w-64 rounded-xl shadow-xl border z-40 p-3 text-xs text-left
                      ${theme === 'dark' ? 'bg-slate-900 border-slate-800 shadow-slate-950/80 text-white' : 'bg-white border-slate-250 shadow-slate-100/40 text-slate-950'}`}
                    >
                      <div className="pb-2.5 border-b mb-2.5 border-slate-800/30">
                        <span className="block font-bold">Workspace Access Account</span>
                        <span className="block font-mono text-[10px] text-slate-500 mt-0.5 select-all">k026c1090@g.neec.ac.jp</span>
                      </div>
                      
                      <div className="space-y-1">
                        <div className={`p-2 rounded border flex items-center justify-between ${theme === 'dark' ? 'bg-slate-950/30 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-150 text-slate-600'}`}>
                          <span>Environment Node</span>
                          <span className="text-emerald-500 font-bold font-mono text-[11px]">Linux VM Port 3000</span>
                        </div>
                        <div className={`p-2 rounded border flex items-center justify-between ${theme === 'dark' ? 'bg-slate-950/30 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-150 text-slate-600'}`}>
                          <span>Classroom Syncer</span>
                          <span className="text-amber-500 font-bold font-mono text-[11px]">Developer Live</span>
                        </div>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-slate-800/20 flex align-center justify-between">
                        <span className="text-[10px] text-slate-500">Google OAuth OK </span>
                        <button 
                          onClick={() => { setIsProfileDropdownOpen(false); triggerNotification("ℹ️ Connected session successfully logged."); }}
                          className="text-emerald-500 font-semibold hover:underline text-[11px]"
                        >
                          Admin Checkup
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

            </div>
          </header>

          {/* MAIN PAGE INTERACTIVE PANELS CONTENT WRAPPER */}
          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
            <div className="max-w-6xl mx-auto space-y-8">
              
              <AnimatePresence mode="wait">
                
                {/* SUB TAB 1: OVERVIEW DASHBOARD & VM DEPLOYMENT GUIDE */}
                {activeTab === 'overview' && (
                  <motion.div
                    key="tab-overview"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-8"
                  >
                    {/* Welcome Banner Card */}
                    <div className={`p-6 rounded-2xl border relative overflow-hidden transition-colors
                      ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}
                    >
                      {/* Subtle back ambient glow elements */}
                      <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none -z-10" />
                      
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2.5">
                            <span className="inline-flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span>Bot Status: Active</span>
                            </span>
                            <span className="inline-flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500 border border-blue-500/20 px-2 py-0.5 rounded-full">
                              <span>Production Stack</span>
                            </span>
                          </div>
                          <h2 className="text-xl md:text-2xl font-bold tracking-tight">Classroom ⇆ Discord Synchronization Hub</h2>
                          <p className={`text-xs md:text-sm max-w-2xl leading-relaxed ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                            This console walks through the real deployment path for the Discord sync bot: configure the Discord application, enable Google Classroom API, generate OAuth files, write the bot `.env`, and verify the Docker Compose services after startup.
                          </p>
                        </div>
                        
                        <div className="shrink-0 flex sm:flex-col gap-2.5">
                          <button
                            onClick={() => setActiveTab('sandbox')}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-4 py-2.5 rounded-xl block text-center shadow-lg shadow-emerald-600/10"
                          >
                            🎮 Run Live Sandbox
                          </button>
                          <button
                            onClick={() => setActiveTab('explorer')}
                            className={`font-semibold text-xs px-4 py-2.5 rounded-xl border block text-center transition
                              ${theme === 'dark' ? 'border-slate-800 hover:bg-slate-800' : 'border-slate-250 hover:bg-slate-50'}`}
                          >
                            📁 Browse Code Files
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Dashboard Statistics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      
                      {/* Stat 1 */}
                      <div className={`p-4 rounded-xl border text-left flex items-center space-x-3 transition-colors
                        ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="w-10 h-10 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-lg flex items-center justify-center shrink-0">
                          <Database className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="block text-slate-500 text-[10px] uppercase font-bold font-mono tracking-wider">Active Links</span>
                          <span className="block text-lg font-bold leading-tight mt-0.5">{dbLinks.length} Courses</span>
                        </div>
                      </div>

                      {/* Stat 2 */}
                      <div className={`p-4 rounded-xl border text-left flex items-center space-x-3 transition-colors
                        ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="w-10 h-10 bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 rounded-lg flex items-center justify-center shrink-0">
                          <Radio className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="block text-slate-500 text-[10px] uppercase font-bold font-mono tracking-wider">Synced Posts</span>
                          <span className="block text-lg font-bold leading-tight mt-0.5">{dbPostedRecords.length} Items</span>
                        </div>
                      </div>

                      {/* Stat 3 */}
                      <div className={`p-4 rounded-xl border text-left flex items-center space-x-3 transition-colors
                        ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="w-10 h-10 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-lg flex items-center justify-center shrink-0">
                          <Cpu className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="block text-slate-500 text-[10px] uppercase font-bold font-mono tracking-wider">Bot Latency</span>
                          <span className="block text-lg font-bold leading-tight mt-0.5">38 ms</span>
                        </div>
                      </div>

                      {/* Stat 4 */}
                      <div className={`p-4 rounded-xl border text-left flex items-center space-x-3 transition-colors
                        ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="w-10 h-10 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-lg flex items-center justify-center shrink-0">
                          <Key className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="block text-slate-500 text-[10px] uppercase font-bold font-mono tracking-wider">Google OAuth</span>
                          <span className="block text-xs font-bold leading-tight text-emerald-500 mt-1 uppercase font-mono">AUTHORIZED</span>
                        </div>
                      </div>

                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {deploymentHighlights.map((item) => (
                        <div
                          key={item.title}
                          className={`p-4 rounded-xl border transition-colors ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                        >
                          <span className="block text-[10px] uppercase tracking-[0.2em] font-bold font-mono text-emerald-500 mb-2">{item.title}</span>
                          <p className={`text-xs leading-relaxed ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>{item.body}</p>
                        </div>
                      ))}
                    </div>

                    {/* VM DOCKER DEPLOYMENT BLUEPRINT CONTAINER (Answers First User Question: 如何部署到linux vm 上的？) */}
                    <div className={`border rounded-xl flex flex-col overflow-hidden transition-colors
                      ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200'}`}
                    >
                      <div className={`p-5 border-b flex items-center justify-between
                        ${theme === 'dark' ? 'border-slate-800 bg-slate-900/60' : 'border-slate-100 bg-slate-50/50'}`}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-9 h-9 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-lg flex items-center justify-center">
                            <Laptop className="w-4.5 h-4.5" />
                          </div>
                          <div className="text-left">
                            <h3 className="font-bold text-sm tracking-tight">Discord Bot + Google Classroom Deployment Flow</h3>
                            <p className="text-[11px] text-slate-500">Specific setup order for OAuth, credentials, `.env`, compose startup, and health checks</p>
                          </div>
                        </div>

                        <span className="text-[10px] font-semibold uppercase tracking-wider font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20 shrink-0">
                          Docker Engine Verified
                        </span>
                      </div>

                      <div className="p-5 md:p-6 space-y-6 text-left">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                          
                          {/* Instructions Column */}
                          <div className="space-y-4 text-xs">
                            <div className="space-y-2">
                              <h4 className={`font-bold ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>Before You Deploy</h4>
                              <p className={`leading-relaxed ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                                The bot only becomes usable after Discord credentials, Google Classroom OAuth files, and the persistent SQLite path are all prepared in the expected locations.
                              </p>
                            </div>

                            <div className={`p-4 rounded-lg border ${theme === 'dark' ? 'bg-slate-950/30 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                              <span className="block text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500 mb-3">Required Checklist</span>
                              <div className="space-y-3">
                                {deploymentChecks.map((item, index) => (
                                  <div key={item} className="flex items-start space-x-3">
                                    <div className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-400 font-bold border border-emerald-500/30 flex items-center justify-center font-mono text-[10px] shrink-0 mt-0.5">
                                      {index + 1}
                                    </div>
                                    <span className={`block leading-tight ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>{item}</span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-4 mt-2">
                              {deploymentSteps.map((item) => (
                                <div key={item.step} className="flex items-start space-x-3">
                                  <div className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-400 font-bold border border-emerald-500/30 flex items-center justify-center font-mono text-[10px] shrink-0 mt-0.5">
                                    {item.step}
                                  </div>
                                  <div className="space-y-1">
                                    <strong className="font-semibold block">{item.title}</strong>
                                    <span className={`block scale-[0.95] leading-tight ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                                      {item.description}
                                    </span>
                                    <code className={`inline-block mt-1 text-[10px] leading-relaxed font-mono px-2 py-1 rounded border break-all ${theme === 'dark' ? 'bg-slate-950/40 border-slate-800 text-emerald-300' : 'bg-slate-100 border-slate-200 text-slate-800'}`}>
                                      {item.command}
                                    </code>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Code snippets block */}
                          <div className="space-y-4">
                            <span className="block text-[10px] font-mono font-bold tracking-wider uppercase text-slate-500">
                              Verification Commands:
                            </span>

                            {/* Code 1 */}
                            <div className="space-y-1">
                              <span className="block text-[10px] font-semibold text-slate-400 font-mono">1. Start the compose stack</span>
                              <div className="bg-slate-950 rounded-lg p-3 font-mono text-xs text-emerald-400 border border-slate-800 flex items-center justify-between select-all leading-relaxed">
                                <code className="truncate pr-4 flex-1">
                                  docker compose -f docker/compose.yml --profile dev up -d --build
                                </code>
                                <button 
                                  onClick={() => { navigator.clipboard.writeText("docker compose -f docker/compose.yml --profile dev up -d --build"); triggerNotification("📋 Command Copied!"); }}
                                  className="text-slate-500 hover:text-emerald-400 shrink-0"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Code 2 */}
                            <div className="space-y-1">
                              <span className="block text-[10px] font-semibold text-slate-400 font-mono">2. Watch bot startup and OAuth status</span>
                              <div className="bg-slate-950 rounded-lg p-3 font-mono text-xs text-emerald-400 border border-slate-800 flex items-center justify-between select-all leading-relaxed">
                                <code className="truncate pr-4 flex-1">
                                  docker compose -f docker/compose.yml --profile dev logs -f bot
                                </code>
                                <button 
                                  onClick={() => { navigator.clipboard.writeText("docker compose -f docker/compose.yml --profile dev logs -f bot"); triggerNotification("📋 Command Copied!"); }}
                                  className="text-slate-500 hover:text-emerald-400 shrink-0"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Code 3 */}
                            <div className="space-y-1">
                              <span className="block text-[10px] font-semibold text-slate-400 font-mono">3. Confirm the dashboard entrypoint</span>
                              <div className="bg-slate-950 rounded-lg p-3 font-mono text-xs text-emerald-400 border border-slate-800 flex items-center justify-between select-all leading-relaxed">
                                <code className="truncate pr-4 flex-1">
                                  docker compose -f docker/compose.yml --profile dev exec web sh -c "wget -qO- http://127.0.0.1:5173/ | grep -E '&lt;title&gt;|src/main'"
                                </code>
                                <button 
                                  onClick={() => { navigator.clipboard.writeText("docker compose -f docker/compose.yml --profile dev exec web sh -c \"wget -qO- http://127.0.0.1:5173/ | grep -E '<title>|src/main'\""); triggerNotification("📋 Command Copied!"); }}
                                  className="text-slate-500 hover:text-emerald-400 shrink-0"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Info Callout */}
                            <div className={`p-4 rounded-lg border text-xs leading-relaxed flex items-start space-x-3
                              ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-150 text-slate-600'}`}
                            >
                              <Info className="w-4.5 h-4.5 text-blue-500 shrink-0 mt-0.5" />
                              <div>
                                <strong className={`block mb-0.5 font-bold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>OAuth bootstrap note:</strong>
                                If the VM cannot open a browser, run <code className={`font-mono p-0.5 border px-1 rounded ${theme === 'dark' ? 'bg-slate-950/40 border-slate-800 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-800'}`}>python src/scripts/setup_google_auth.py</code> on a local machine first, then upload `client_secret.json` and `token.json` to `credentials/`.
                              </div>
                            </div>
                          </div>

                        </div>
                      </div>
                    </div>

                  </motion.div>
                )}

                {/* SUB TAB 2: ACTIVE DISCORD BOT SLASH COMMANDS CATALOG (Answers Second User Question) */}
                {activeTab === 'commands' && (
                  <motion.div
                    key="tab-commands"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-8"
                  >
                    {/* Header Details */}
                    <div className="text-left space-y-2">
                      <h2 className="text-xl font-bold flex items-center space-x-2">
                        <Command className="text-emerald-500" />
                        <span>Registered Discord Slash Commands Guide</span>
                      </h2>
                      <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                        The current python code defines a highly cohesive Slash command tree globally nested under the Discord Application Interface. Below is an exhaustive list of all ready-to-use commands currently in our codebase.
                      </p>
                    </div>

                    {/* Commands Card Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                      
                      {/* Command 1 */}
                      <div className={`p-5 rounded-xl border flex flex-col justify-between space-y-4 transition-colors
                        ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                              /classroom courses
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-800/40 px-2 py-0.5 rounded">
                              Admin Role Only
                            </span>
                          </div>
                          <p className={`text-xs ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                            Lists all active courses from your Google Classroom profile. This displays the course name, section, description, and unique IDs required to perform channel sync links.
                          </p>
                        </div>
                        <div className="pt-3 border-t border-slate-800/40 flex items-center justify-between text-[11px] text-slate-500">
                          <span>Arguments: **None**</span>
                          <button onClick={() => { setActiveTab('sandbox'); triggerNotification("Redirected to Sandbox Courses!"); }} className="text-emerald-500 hover:underline">
                            Test in Sandbox →
                          </button>
                        </div>
                      </div>

                      {/* Command 2 */}
                      <div className={`p-5 rounded-xl border flex flex-col justify-between space-y-4 transition-colors
                        ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                              /classroom link
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-800/40 px-2 py-0.5 rounded">
                              Admin Role Only
                            </span>
                          </div>
                          <p className={`text-xs ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                            Connects and maps a specific Google Classroom Course to a target Discord text channel in the current guild.
                          </p>
                        </div>
                        <div className="pt-3 border-t border-slate-800/40 flex items-center justify-between text-[11px] text-slate-500">
                          <span className="space-x-1 font-mono text-[10px] bg-slate-950/40 p-1 rounded">
                            <span>course_id (str)</span> &bull; <span>channel (discord)</span>
                          </span>
                          <button onClick={() => { setActiveTab('sandbox'); }} className="text-emerald-500 hover:underline">
                            Link course →
                          </button>
                        </div>
                      </div>

                      {/* Command 3 */}
                      <div className={`p-5 rounded-xl border flex flex-col justify-between space-y-4 transition-colors
                        ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                              /classroom unlink
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-800/40 px-2 py-0.5 rounded">
                              Admin Role Only
                            </span>
                          </div>
                          <p className={`text-xs ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                            Deactivates and completely deletes a Google Classroom course link mapping in the current Discord server.
                          </p>
                        </div>
                        <div className="pt-3 border-t border-slate-800/40 flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-mono text-[10px] bg-slate-950/40 p-1 rounded">
                            course_id (str)
                          </span>
                          <button onClick={() => setActiveTab('sandbox')} className="text-emerald-500 hover:underline">
                            View mapping table →
                          </button>
                        </div>
                      </div>

                      {/* Command 4 */}
                      <div className={`p-5 rounded-xl border flex flex-col justify-between space-y-4 transition-colors
                        ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                              /classroom list
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-800/40 px-2 py-0.5 rounded">
                              Admin Role Only
                            </span>
                          </div>
                          <p className={`text-xs ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                            Retrieves and lists all connected/linked Google Classroom courses in the current Discord server, showing matched text channels and sync timestamps.
                          </p>
                        </div>
                        <div className="pt-3 border-t border-slate-800/40 flex items-center justify-between text-[11px] text-slate-500">
                          <span>Arguments: **None**</span>
                          <button onClick={() => setActiveTab('sandbox')} className="text-emerald-500 hover:underline">
                            View Sandbox Database →
                          </button>
                        </div>
                      </div>

                      {/* Command 5 */}
                      <div className={`p-5 rounded-xl border flex flex-col justify-between space-y-4 transition-colors
                        ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                              /classroom sync
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-800/40 px-2 py-0.5 rounded">
                              Admin Role Only
                            </span>
                          </div>
                          <p className={`text-xs ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                            Forces an immediate, non-blocking sync pass to fetch announcements and assignment updates from linked Classroom courses.
                          </p>
                        </div>
                        <div className="pt-3 border-t border-slate-800/40 flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-mono text-[10px] bg-slate-950/40 p-1 rounded">
                            course_id (str, optional)
                          </span>
                          <button onClick={() => setActiveTab('sandbox')} className="text-emerald-500 hover:underline">
                            Force sync poller →
                          </button>
                        </div>
                      </div>

                      {/* Command 6 */}
                      <div className={`p-5 rounded-xl border flex flex-col justify-between space-y-4 transition-colors
                        ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                              /classroom post
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-800/40 px-2 py-0.5 rounded">
                              Admin Role Only
                            </span>
                          </div>
                          <p className={`text-xs ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                            Fires up an interactive Discord UI dialog popup modal allowing teacher/administrator roles to write and publish announcements directly back to Google Classroom channels.
                          </p>
                        </div>
                        <div className="pt-3 border-t border-slate-800/40 flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-mono text-[10px] bg-slate-950/40 p-1 rounded">
                            course_id (str)
                          </span>
                          <button onClick={() => { setActiveTab('sandbox'); setShowPostModal(true); }} className="text-emerald-500 hover:underline">
                            Launch UI modal →
                          </button>
                        </div>
                      </div>

                      {/* Command 7 */}
                      <div className={`p-5 rounded-xl border flex flex-col justify-between space-y-4 transition-colors
                        ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-blue-500 bg-blue-500/10 px-2.5 py-1 rounded-md border border-blue-500/20">
                              /status
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-800/40 px-2 py-0.5 rounded">
                              Admin Role Only
                            </span>
                          </div>
                          <p className={`text-xs ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                            Queries bot health metrics, API response latency, system uptime and verification of authorized Classroom user credentials.
                          </p>
                        </div>
                        <div className="pt-3 border-t border-slate-800/40 flex items-center justify-between text-[11px] text-slate-500">
                          <span>Arguments: **None**</span>
                          <span className="text-blue-500 font-mono font-bold uppercase text-[10px]">Diagnostician</span>
                        </div>
                      </div>

                    </div>

                  </motion.div>
                )}

                {/* SUB TAB 3: LIVE SANDBOX SIMULATOR */}
                {activeTab === 'sandbox' && (
                  <motion.div
                    key="tab-sandbox"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-6"
                  >
                    
                    {/* Simulator Layout split columns */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start text-left">
                      
                      {/* Left Column Controls (5 columns) */}
                      <div className="lg:col-span-12 xl:col-span-5 space-y-6">
                        
                        {/* Control Card 1: Course linking creator */}
                        <div className={`p-5 rounded-xl border space-y-4 transition-colors
                          ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                        >
                          <div className="flex items-center space-x-2">
                            <Database className="text-emerald-500 w-5 h-5 shrink-0" />
                            <h3 className="font-bold text-sm tracking-tight">Active Mappings Database</h3>
                          </div>
                          
                          <p className={`text-[11px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-650'}`}>
                            Simulate `/classroom link` command behavior. Map virtual Google Classroom channels below with Discord feeds, and register active link records in the DB table schema.
                          </p>

                          <div className="space-y-3.5 pt-2">
                            {/* Course selection */}
                            <div className="space-y-1">
                              <label className={`block text-[10px] uppercase font-bold tracking-wider font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                                1. Select Google Classroom Course:
                              </label>
                              <select
                                value={selectedSimCourse}
                                onChange={(e) => setSelectedSimCourse(e.target.value)}
                                className={`w-full text-xs p-2.5 rounded-lg border focus:outline-none focus:border-emerald-500/50 
                                  ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
                              >
                                {simulateCourses.map(c => (
                                  <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                                ))}
                              </select>
                            </div>

                            {/* Channel mapping selection */}
                            <div className="space-y-1">
                              <label className={`block text-[10px] uppercase font-bold tracking-wider font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                                2. Map to Discord Channel:
                              </label>
                              <select
                                value={selectedSimChannel}
                                onChange={(e) => setSelectedSimChannel(e.target.value)}
                                className={`w-full text-xs p-2.5 rounded-lg border focus:outline-none focus:border-emerald-500/50
                                  ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
                              >
                                {simulateChannels.map(ch => (
                                  <option key={ch.id} value={ch.id}>#{ch.name}</option>
                                ))}
                              </select>
                            </div>

                            {/* Create Button */}
                            <button
                              onClick={handleCreateLink}
                              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2.5 rounded-lg flex items-center justify-center space-x-2 transition"
                            >
                              <Plus className="w-4 h-4" />
                              <span>Execute Link Command (/classroom link)</span>
                            </button>
                          </div>
                        </div>

                        {/* Control Card 2: Manual Delta Trigger poller */}
                        <div className={`p-5 rounded-xl border space-y-4 transition-colors
                          ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                        >
                          <div className="flex items-center space-x-2">
                            <RefreshCw className="text-amber-500 w-5 h-5 shrink-0 animate-spin-slow" />
                            <h3 className="font-bold text-sm tracking-tight font-sans">Force Synchronizer poller</h3>
                          </div>

                          <p className={`text-[11px] leading-relaxed ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                            Simulates `/classroom sync` slash command or the background scheduler thread loop. Triggers database schema querying to find unposted Classroom coursework or announcement logs.
                          </p>

                          <button
                            onClick={handleRunSync}
                            className={`w-full flex items-center justify-center space-x-2 text-xs font-semibold py-2.5 border rounded-lg transition
                              ${theme === 'dark' ? 'bg-slate-950/40 border-slate-800 hover:bg-slate-800 text-amber-400' : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-amber-700'}`}
                          >
                            <RefreshCw className="w-4 h-4" />
                            <span>Force Sync Poller (/classroom sync)</span>
                          </button>
                        </div>

                      </div>

                      {/* Right Column Database lists & discord UI viewer (7 columns) */}
                      <div className="lg:col-span-12 xl:col-span-7 space-y-6">
                        
                        {/* Row A: DB State listings and Linked course cards */}
                        <div className={`border rounded-xl flex flex-col overflow-hidden transition-colors
                          ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}
                        >
                          <div className={`px-4 py-3 border-b flex items-center justify-between
                            ${theme === 'dark' ? 'border-slate-800 bg-slate-950/40' : 'border-slate-100 bg-slate-50'}`}
                          >
                            <span className="text-xs font-semibold uppercase tracking-wider font-mono text-slate-500">
                              SQLite Database: `guild_course_links` Table
                            </span>
                            <span className="text-[10px] font-bold font-mono text-blue-500 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded">
                              SQLModel Active Records
                            </span>
                          </div>

                          <div className="overflow-x-auto">
                            {dbLinks.length === 0 ? (
                              <div className="p-8 text-center text-xs text-slate-500">
                                No active integration mappings registered in SQLite database. Use the linker tool!
                              </div>
                            ) : (
                              <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                  <tr className={`border-b ${theme === 'dark' ? 'border-slate-800 text-slate-450 bg-slate-950/20' : 'border-slate-200 text-slate-500 bg-slate-50'}`}>
                                    <th className="py-2 px-3 shrink-0">Unlink</th>
                                    <th className="py-2 px-3">Classroom Course</th>
                                    <th className="py-2 px-3">Discord Channel</th>
                                    <th className="py-2 px-3">Status</th>
                                  </tr>
                                </thead>
                                <tbody className={`divide-y ${theme === 'dark' ? 'divide-slate-850' : 'divide-slate-200'}`}>
                                  {dbLinks.map((link) => {
                                    const linkedCourse = simulateCourses.find(c => c.id === link.courseId);
                                    const targetChan = simulateChannels.find(ch => ch.id === link.channelId);
                                    return (
                                      <tr key={link.id} className={`hover:bg-slate-100/10`}>
                                        <td className="py-2 px-3">
                                          <button
                                            onClick={() => handleUnlink(link.id)}
                                            className="text-red-500 hover:text-red-400 p-1 rounded"
                                            title="Unlink integration map record"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </td>
                                        <td className="py-2 px-3 font-medium">
                                          <div>{linkedCourse?.name || 'Unknown'}</div>
                                          <div className="text-[10px] text-slate-550 font-mono">ID: {link.courseId}</div>
                                        </td>
                                        <td className="py-2 px-3 font-mono">
                                          #{targetChan?.name || 'unknown'}
                                        </td>
                                        <td className="py-2 px-3">
                                          <span className="inline-flex items-center space-x-1.5 text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 border border-emerald-550/20 rounded">
                                            Active
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </div>

                        {/* Interactive Bidirectional Posting trigger Panel */}
                        <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-center justify-between gap-4 transition-colors
                          ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}
                        >
                          <div className="text-left space-y-1 flex-1">
                            <h4 className="text-xs font-bold font-sans flex items-center space-x-2">
                              <ExternalLink className="text-emerald-500 w-4 h-4" />
                              <span>Test Bidirectional posting modal (/classroom post)</span>
                            </h4>
                            <p className={`text-[11px] leading-tight ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                              Launch the interactive Discord user popup Modal, write a message, and publish it back directly onto Google Classroom API feeds.
                            </p>
                          </div>
                          <button
                            onClick={() => setShowPostModal(true)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-3.5 py-2.5 rounded-lg w-full md:w-auto shrink-0 transition"
                          >
                            Launch post Modal
                          </button>
                        </div>

                        {/* Discord Server Mock Workspace UI Frame */}
                        <div className="border border-slate-800 rounded-xl bg-[#313338] text-[#dbdee1] flex flex-col h-96 overflow-hidden shadow-2xl relative">
                          
                          {/* Discord top active bar */}
                          <div className="h-12 bg-[#313338] border-b border-[#1f2023] flex items-center justify-between px-4 shrink-0 shadow-sm select-none">
                            <div className="flex items-center space-x-2">
                              <span className="text-[#80848e] font-bold text-xl font-sans">#</span>
                              <span className="font-bold text-xs text-[#f2f3f5] font-sans">
                                {activeChannelId === "1" ? "announcements" : activeChannelId === "2" ? "homework-assignments" : "general"}
                              </span>
                              <span className="font-mono text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 rounded-md uppercase font-bold shrink-0">linked</span>
                            </div>
                            
                            <div className="flex items-center space-x-3 text-[#dbdee1]">
                              <span className="text-[10px] text-[#949ba4] font-semibold bg-[#2b2d31] px-2 py-0.5 rounded">Mock Discord Chat</span>
                            </div>
                          </div>

                          {/* Inner chat scrolling views */}
                          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                            
                            {/* Filtered messages */}
                            {discordMessages.map((msg, idx) => (
                              <div key={idx} className="flex items-start space-x-3 text-left">
                                <div className={`w-8 h-8 rounded-full ${msg.avatarColor} text-white font-bold flex items-center justify-center font-mono uppercase text-xs shrink-0 select-none`}>
                                  {msg.author[0]}
                                </div>
                                <div className="space-y-1 flex-1 min-w-0">
                                  <div className="flex items-baseline space-x-2">
                                    <span className="font-bold text-[#f2f3f5] hover:underline cursor-pointer">{msg.author}</span>
                                    {msg.isBot && <span className="bg-[#5865f2] text-white font-mono text-[9px] px-1 rounded font-bold uppercase scale-[0.85]">BOT</span>}
                                    <span className="text-[9px] text-[#949ba4] font-mono">{msg.timestamp}</span>
                                  </div>
                                  
                                  {msg.content && <p className="text-[#dbdee1] leading-relaxed break-words">{msg.content}</p>}

                                  {msg.embed && (
                                    <div className="border-l-4 border-emerald-500 rounded bg-[#2b2d31] p-3 max-w-sm space-y-2 mt-1">
                                      <span className="block font-bold text-sm text-[#f2f3f5] hover:underline cursor-pointer">{msg.embed.title}</span>
                                      <p className="text-[11px] leading-relaxed text-[#949ba4]">{msg.embed.description}</p>
                                      {msg.embed.fields && msg.embed.fields.map((f, fIdx) => (
                                        <div key={fIdx} className="space-y-0.5 mt-2">
                                          <span className="block font-bold text-[10px] text-[#f2f3f5] uppercase font-sans tracking-wide">{f.name}</span>
                                          <p className="text-[11px] leading-snug font-mono text-emerald-400">{f.value}</p>
                                        </div>
                                      ))}
                                      <div className="pt-1.5 border-t border-slate-700/50 text-[9px] text-[#949ba4] font-mono">{msg.embed.footer}</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}

                          </div>

                          {/* Chat footer input panel */}
                          <div className="p-3 bg-[#313338] shrink-0 select-none">
                            <div className="bg-[#383a40] rounded-xl px-4 py-2 flex items-center space-x-3.5 border border-[#2b2d31]">
                              <span className="text-slate-500 font-bold text-base bg-[#404249] w-6 h-6 flex items-center justify-center rounded-full shrink-0 select-none">+</span>
                              <div className="flex-1 text-left text-xs text-[#949ba4]">
                                Messages in simulated guild. Sync daemon monitoring loop is active.
                              </div>
                              <Send className="w-4 h-4 text-slate-500 shrink-0" />
                            </div>
                          </div>

                        </div>

                      </div>

                    </div>

                  </motion.div>
                )}

                {/* SUB TAB 4: FILE EXPLORER / DEVELOPMENT MODULES CENTER */}
                {activeTab === 'explorer' && (
                  <motion.div
                    key="tab-explorer"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.15 }}
                    className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
                  >
                    
                    {/* Explorer File index on Left (4 columns) */}
                    <div className={`lg:col-span-12 xl:col-span-4 border rounded-xl p-4 flex flex-col space-y-3.5 text-left transition-colors
                      ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                    >
                      <h3 className="font-bold text-sm pb-2 border-b border-slate-800/20">src/</h3>
                      
                      <div className="space-y-1.5 overflow-y-auto max-h-[450px] pr-1">
                        {pythonFiles.map((file, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedFile(file)}
                            className={`w-full text-left p-2.5 rounded-lg text-xs font-mono transition duration-150 flex items-center justify-between border
                              ${selectedFile.name === file.name 
                                ? 'bg-emerald-600/10 text-emerald-500 border-emerald-500/35 font-bold border-l-4' 
                                : theme === 'dark'
                                  ? 'hover:bg-slate-800/40 hover:text-slate-100 text-slate-400 border-transparent'
                                  : 'hover:bg-slate-100 hover:text-slate-900 text-slate-700 border-transparent'}`}
                          >
                            <div className="flex items-center space-x-2.5 min-w-0">
                              <FileText className={`w-4 h-4 shrink-0 ${file.language === 'python' ? 'text-blue-400' : 'text-amber-400'}`} />
                              <span className="truncate">{file.name}</span>
                            </div>
                            <span className="text-[9px] text-slate-500 shrink-0 uppercase font-mono">{file.language}</span>
                          </button>
                        ))}
                      </div>

                      <div className={`mt-4 pt-3 border-t p-3.5 rounded-xl text-[11px] leading-relaxed
                        ${theme === 'dark' ? 'bg-slate-950/40 border-slate-850 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600 shadow-inner'}`}
                      >
                        <div className="font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide text-[9px] mb-1 font-mono">Module Role:</div>
                        <div>{selectedFile.description}</div>
                      </div>
                    </div>

                    {/* Integrated Source Code Editor Viewer (8 columns) */}
                    <div className={`lg:col-span-12 xl:col-span-8 border rounded-xl flex flex-col overflow-hidden max-h-[640px] text-left transition-colors
                      ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}
                    >
                      <div className={`border-b p-3 flex items-center justify-between shrink-0
                        ${theme === 'dark' ? 'border-slate-850 bg-slate-950/80' : 'border-slate-100 bg-slate-50'}`}>
                        <span className="text-xs font-mono text-slate-400 flex items-center space-x-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span>{selectedFile.path}</span>
                        </span>
                        
                        <button
                          onClick={() => copyToClipboard(selectedFile.content, false)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600/10 text-emerald-500 hover:bg-emerald-600/25 text-xs flex items-center space-x-1.5 transition duration-150 border border-emerald-500/20"
                        >
                          {copiedFile ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500 animate-bounce" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedFile ? 'Copied' : 'Copy module'}</span>
                        </button>
                      </div>

                      <pre className="p-4 overflow-auto font-mono text-[11px] leading-relaxed text-slate-300 bg-slate-950 select-all flex-1 h-[480px]">
                        <code>
                          {selectedFile.content.split('\n').map((line, idx) => (
                            <div key={idx} className="table-row">
                              <span className="table-cell text-slate-600 hover:text-slate-500 text-right pr-4 select-none w-8 text-[10px] bg-slate-950/20">{idx + 1}</span>
                              <span className="table-cell pl-2 text-slate-350">{line}</span>
                            </div>
                          ))}
                        </code>
                      </pre>
                    </div>

                  </motion.div>
                )}

                {/* SUB TAB 5: ENVIRONMENT PARAMETERS AND CONFIGURATOR */}
                {activeTab === 'configurator' && (
                  <motion.div
                    key="tab-configurator"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.15 }}
                    className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-left items-start"
                  >
                    
                    {/* Control Form Parameters Cards on left (5 columns) */}
                    <div className={`lg:col-span-12 xl:col-span-5 border rounded-xl p-5 space-y-4.5 transition-colors
                      ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}
                    >
                      <h3 className="font-bold text-sm border-b pb-2 border-slate-800/20">Configure Environment Keys</h3>
                      <p className={`text-[11px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                        Fill the actual runtime values used by the Discord bot container, including whether the bot should connect to Discord immediately or stay idle for setup-only sessions.
                      </p>
                      
                      <div className="space-y-3 text-xs">
                        {/* Box 1 */}
                        <div className="space-y-1">
                          <label className={`block text-[10px] uppercase font-bold tracking-wider font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Discord Bot Token:</label>
                          <input 
                            type="password"
                            value={botToken}
                            onChange={(e) => setBotToken(e.target.value)}
                            className={`w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500/50 
                              ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-350' : 'bg-slate-50 border-slate-250 text-slate-900'}`}
                          />
                        </div>

                        <div className="space-y-1">
                          <label className={`block text-[10px] uppercase font-bold tracking-wider font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Bot Runtime Mode:</label>
                          <select
                            value={botEnabled ? 'true' : 'false'}
                            onChange={(e) => setBotEnabled(e.target.value === 'true')}
                            className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-emerald-500/50
                              ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-350' : 'bg-slate-50 border-slate-250 text-slate-900'}`}
                          >
                            <option value="true">BOT_ENABLED=true - connect to Discord and run scheduler</option>
                            <option value="false">BOT_ENABLED=false - keep container up without logging in</option>
                          </select>
                        </div>

                        {/* Box 2 */}
                        <div className="space-y-1">
                          <label className={`block text-[10px] uppercase font-bold tracking-wider font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Sync Polling Interval (Minutes):</label>
                          <input 
                            type="number"
                            value={syncInterval}
                            onChange={(e) => setSyncInterval(Number(e.target.value))}
                            className={`w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500/50
                              ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-350' : 'bg-slate-50 border-slate-250 text-slate-900'}`}
                          />
                        </div>

                        {/* Box 3 */}
                        <div className="space-y-1">
                          <label className={`block text-[10px] uppercase font-bold tracking-wider font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>SQLite DB path (Mounted volume URI):</label>
                          <input 
                            type="text"
                            value={dbUrl}
                            onChange={(e) => setDbUrl(e.target.value)}
                            className={`w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500/50
                              ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-350' : 'bg-slate-50 border-slate-250 text-slate-900'}`}
                          />
                        </div>

                        {/* Box 4 */}
                        <div className="grid grid-cols-2 gap-3.5">
                          <div className="space-y-1">
                            <label className={`block text-[9px] uppercase font-bold tracking-wider font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Client Secrets URI:</label>
                            <input 
                              type="text"
                              value={credsFile}
                              onChange={(e) => setCredsFile(e.target.value)}
                              className={`w-full border rounded px-3 py-2 text-[10px] font-mono focus:outline-none focus:border-emerald-500/50
                                ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-350' : 'bg-slate-50 border-slate-250 text-slate-900'}`}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className={`block text-[9px] uppercase font-bold tracking-wider font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Session Token path:</label>
                            <input 
                              type="text"
                              value={tokenFile}
                              onChange={(e) => setTokenFile(e.target.value)}
                              className={`w-full border rounded px-3 py-2 text-[10px] font-mono focus:outline-none focus:border-emerald-500/50
                                ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-350' : 'bg-slate-50 border-slate-250 text-slate-900'}`}
                            />
                          </div>
                        </div>

                        {/* Box 5 */}
                        <div className="space-y-1">
                          <label className={`block text-[10px] uppercase font-bold tracking-wider font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Logging verbosity level:</label>
                          <select 
                            value={logLevel}
                            onChange={(e) => setLogLevel(e.target.value)}
                            className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-emerald-500/50
                              ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-350' : 'bg-slate-50 border-slate-250 text-slate-900'}`}
                          >
                            <option value="DEBUG">DEBUG - Verbose developer traces</option>
                            <option value="INFO">INFO - Default notification logs</option>
                            <option value="WARNING">WARNING - Minor warnings</option>
                            <option value="ERROR">ERROR - Strict execution errors</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Env preview text area right (7 columns) */}
                    <div className={`lg:col-span-12 xl:col-span-7 border rounded-xl flex flex-col overflow-hidden max-h-[500px] transition-colors
                      ${theme === 'dark' ? 'bg-slate-900 border-slate-800 hover:border-slate-700/60' : 'bg-white border-slate-200 shadow-sm'}`}
                    >
                      <div className={`px-4 py-3 border-b flex items-center justify-between shrink-0
                        ${theme === 'dark' ? 'border-slate-850 bg-slate-950/80' : 'border-slate-100 bg-slate-50'}`}>
                        <span className="text-xs font-mono text-slate-400">Environment Exporter (.env)</span>
                        
                        <div className="flex items-center space-x-2 shrink-0">
                          <button
                            onClick={() => copyToClipboard(generatedEnv, true)}
                            className="px-3 py-1.5 rounded bg-[#2b2d31] hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-800 text-xs flex items-center space-x-1"
                          >
                            {copiedEnv ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedEnv ? 'Copied' : 'Copy'}</span>
                          </button>
                          <button
                            onClick={downloadEnvFile}
                            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs flex items-center space-x-1"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download .env</span>
                          </button>
                        </div>
                      </div>

                      <pre className="p-4 bg-slate-950 font-mono text-xs text-slate-300 leading-relaxed overflow-auto flex-1 select-all h-[400px]">
                        <code>{generatedEnv}</code>
                      </pre>
                    </div>

                  </motion.div>
                )}

              </AnimatePresence>

            </div>
          </main>

        </div>

      </div>

      {/* DISCORD MODAL POPUP SIMULATOR BOX (Fires up for /classroom post simulation) */}
      <AnimatePresence>
        {showPostModal && (
          <>
            {/* Backdrop */}
            <div 
              onClick={() => setShowPostModal(false)}
              className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 pointer-events-auto"
            />
            {/* Modal */}
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full max-w-md z-50 p-6 rounded-2xl bg-[#313338] border border-slate-800 text-[#dbdee1] text-left shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-[#2b2d31] pb-3 mb-4 shrink-0">
                <span className="font-bold text-sm tracking-tight text-[#f2f3f5] flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping shrink-0" />
                  <span>Post Announcement • Discord Popup UI</span>
                </span>
                <button onClick={() => setShowPostModal(false)} className="p-1 rounded hover:bg-slate-700 text-[#dbdee1]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleMockPostSubmit} className="space-y-4 text-xs">
                {/* Field 1 */}
                <div className="space-y-1">
                  <label className="block text-[10px] uppercase font-bold text-[#b5bac1] tracking-wider font-mono">
                    Select Target Classroom course:
                  </label>
                  <select
                    value={modalCourseId}
                    onChange={(e) => setModalCourseId(e.target.value)}
                    className="w-full bg-[#1e1f22] border border-[#2b2d31] text-[#dbdee1] p-2.5 rounded-lg focus:outline-none focus:border-emerald-500"
                  >
                    {simulateCourses.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Field 2 */}
                <div className="space-y-1">
                  <label className="block text-[10px] uppercase font-bold text-[#b5bac1] tracking-wider font-mono">
                    Announcement Title / Header:
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    placeholder="e.g., Reading Assignment / Weekly Review Schedule"
                    value={modalTitle}
                    onChange={(e) => setModalTitle(e.target.value)}
                    className="w-full bg-[#1e1f22] border border-[#2b2d31] text-[#dbdee1] p-2.5 rounded-lg focus:outline-none focus:border-emerald-500 placeholder-slate-600"
                  />
                </div>

                {/* Field 3 */}
                <div className="space-y-1">
                  <label className="block text-[10px] uppercase font-bold text-[#b5bac1] tracking-wider font-mono">
                    content description / announcement feed post:
                  </label>
                  <textarea
                    rows={4}
                    required
                    maxLength={2000}
                    placeholder="Write announcement body markup here..."
                    value={modalDescription}
                    onChange={(e) => setModalDescription(e.target.value)}
                    className="w-full bg-[#1e1f22] border border-[#2b2d31] text-[#dbdee1] p-2.5 rounded-lg focus:outline-none focus:border-emerald-500 placeholder-slate-600"
                  />
                </div>

                {/* Submit button */}
                <div className="pt-2 flex items-center justify-end space-x-3 text-xs">
                  <button 
                    type="button" 
                    onClick={() => setShowPostModal(false)}
                    className="px-4 py-2 hover:bg-[#383a40] text-slate-350 font-medium rounded-lg"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="px-4 py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white font-semibold rounded-lg shadow-md"
                  >
                    Post to Google Classroom
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
}
