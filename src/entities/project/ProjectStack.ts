import { DeploymentProvider } from './DeploymentProvider.js';

export enum ProjectStackTag {
	LanguagePHP = 'php',
	LanguageJavaScript = 'javascript_typescript',
	LanguagePython = 'python',
	LanguageRuby = 'ruby',
	LanguageOther = 'language_other',
	FrameworkLaravel = 'laravel',
	FrameworkSymfony = 'symfony',
	FrameworkYii2 = 'yii2',
	FrameworkCakePHP = 'cakephp',
	FrameworkCodeIgniter = 'codeigniter',
	FrameworkPlainPHP = 'plain_php',
	FrameworkNode = 'node_express',
	FrameworkNext = 'nextjs',
	FrameworkRemix = 'remix',
	FrameworkNuxt = 'nuxtjs',
	FrameworkSvelteKit = 'sveltekit',
	FrameworkAstro = 'astro',
	FrameworkSolidStart = 'solidstart',
	FrameworkVanillaJS = 'vanilla_js',
	FrameworkDjango = 'django',
	FrameworkFastAPI = 'fastapi',
	FrameworkFlask = 'flask',
	FrameworkPlainPython = 'plain_python',
	FrameworkRails = 'rails',
	FrameworkSinatra = 'sinatra',
	FrameworkPlainRuby = 'plain_ruby',
	FrameworkOther = 'framework_other',
	PlatformLaravelCloud = 'laravel_cloud',
	PlatformLaravelForge = 'laravel_forge',
	PlatformLaravelVapor = 'laravel_vapor',
	PlatformDockerCompose = 'docker_compose',
	PlatformKubernetes = 'kubernetes',
	PlatformAWS = 'aws',
	PlatformDigitalOcean = 'digitalocean',
	PlatformVercel = 'vercel',
	PlatformNetlify = 'netlify',
	PlatformRender = 'render',
	PlatformFlyIO = 'flyio',
	PlatformSelfHosted = 'platform_other',
}

export type ProjectStackCategory = 'language' | 'framework' | 'platform';

export type ProjectStackShape = Partial<Record<ProjectStackCategory, ProjectStackTag>>;

type ProjectStackTagMeta = {
	label: string;
	description: string;
};

const STACK_TAG_META: Record<ProjectStackTag, ProjectStackTagMeta> = {
	[ProjectStackTag.LanguagePHP]: {
		label: 'PHP',
		description: 'General-purpose PHP applications.',
	},
	[ProjectStackTag.LanguageJavaScript]: {
		label: 'JavaScript / TypeScript',
		description: 'JavaScript or TypeScript runtimes.',
	},
	[ProjectStackTag.LanguagePython]: {
		label: 'Python',
		description: 'Python services and CLIs.',
	},
	[ProjectStackTag.LanguageRuby]: {
		label: 'Ruby',
		description: 'Ruby applications.',
	},
	[ProjectStackTag.LanguageOther]: {
		label: 'Other',
		description: 'Another primary language or mixed stack.',
	},
	[ProjectStackTag.FrameworkLaravel]: {
		label: 'Laravel',
		description: 'Full-stack Laravel framework.',
	},
	[ProjectStackTag.FrameworkSymfony]: {
		label: 'Symfony',
		description: 'Symfony PHP applications.',
	},
	[ProjectStackTag.FrameworkYii2]: {
		label: 'Yii2',
		description: 'Yii2 PHP framework.',
	},
	[ProjectStackTag.FrameworkCakePHP]: {
		label: 'CakePHP',
		description: 'CakePHP MVC applications.',
	},
	[ProjectStackTag.FrameworkCodeIgniter]: {
		label: 'CodeIgniter',
		description: 'CodeIgniter PHP framework.',
	},
	[ProjectStackTag.FrameworkPlainPHP]: {
		label: 'None / Plain PHP',
		description: 'Custom or framework-less PHP.',
	},
	[ProjectStackTag.FrameworkNode]: {
		label: 'Node.js (Express, NestJS, Fastify)',
		description: 'APIs built with Node.js frameworks like Express, NestJS, or Fastify.',
	},
	[ProjectStackTag.FrameworkNext]: {
		label: 'Next.js',
		description: 'React full-stack Next.js.',
	},
	[ProjectStackTag.FrameworkRemix]: {
		label: 'Remix',
		description: 'React Remix applications.',
	},
	[ProjectStackTag.FrameworkNuxt]: {
		label: 'Nuxt.js',
		description: 'Vue-based Nuxt.js applications.',
	},
	[ProjectStackTag.FrameworkSvelteKit]: {
		label: 'SvelteKit',
		description: 'SvelteKit apps and APIs.',
	},
	[ProjectStackTag.FrameworkAstro]: {
		label: 'Astro',
		description: 'Astro islands architecture.',
	},
	[ProjectStackTag.FrameworkSolidStart]: {
		label: 'SolidStart',
		description: 'SolidStart SSR applications.',
	},
	[ProjectStackTag.FrameworkVanillaJS]: {
		label: 'Vanilla JS / Other',
		description: 'Custom JavaScript or TypeScript stack.',
	},
	[ProjectStackTag.FrameworkDjango]: {
		label: 'Django',
		description: 'Django monolith or API.',
	},
	[ProjectStackTag.FrameworkFastAPI]: {
		label: 'FastAPI',
		description: 'Python FastAPI services.',
	},
	[ProjectStackTag.FrameworkFlask]: {
		label: 'Flask',
		description: 'Python Flask services.',
	},
	[ProjectStackTag.FrameworkPlainPython]: {
		label: 'Plain Python / Other',
		description: 'Custom Python services or scripts.',
	},
	[ProjectStackTag.FrameworkRails]: {
		label: 'Rails',
		description: 'Ruby on Rails applications.',
	},
	[ProjectStackTag.FrameworkSinatra]: {
		label: 'Sinatra',
		description: 'Ruby Sinatra services.',
	},
	[ProjectStackTag.FrameworkPlainRuby]: {
		label: 'Plain Ruby / Other',
		description: 'Custom Ruby services or scripts.',
	},
	[ProjectStackTag.FrameworkOther]: {
		label: 'Other / Custom framework',
		description: 'Another framework or bespoke stack.',
	},
	[ProjectStackTag.PlatformLaravelCloud]: {
		label: 'Laravel Cloud',
		description: 'Laravel Cloud hosting platform.',
	},
	[ProjectStackTag.PlatformLaravelForge]: {
		label: 'Laravel Forge',
		description: 'Laravel Forge-managed servers.',
	},
	[ProjectStackTag.PlatformLaravelVapor]: {
		label: 'Laravel Vapor',
		description: 'Serverless Laravel Vapor platform.',
	},
	[ProjectStackTag.PlatformDockerCompose]: {
		label: 'Docker / Compose',
		description: 'Containers via Docker or docker-compose.',
	},
	[ProjectStackTag.PlatformKubernetes]: {
		label: 'Kubernetes',
		description: 'Workloads deployed to Kubernetes.',
	},
	[ProjectStackTag.PlatformAWS]: {
		label: 'AWS (EC2, ECS, Lambda)',
		description: 'Services hosted on AWS primitives.',
	},
	[ProjectStackTag.PlatformDigitalOcean]: {
		label: 'DigitalOcean Apps / Droplets',
		description: 'DigitalOcean App Platform or droplets.',
	},
	[ProjectStackTag.PlatformVercel]: {
		label: 'Vercel',
		description: 'Vercel serverless platform.',
	},
	[ProjectStackTag.PlatformNetlify]: {
		label: 'Netlify',
		description: 'Netlify sites and functions.',
	},
	[ProjectStackTag.PlatformRender]: {
		label: 'Render',
		description: 'Render hosted applications.',
	},
	[ProjectStackTag.PlatformFlyIO]: {
		label: 'Fly.io',
		description: 'Fly.io globally distributed apps.',
	},
	[ProjectStackTag.PlatformSelfHosted]: {
		label: 'Other / Self-hosted',
		description: 'Custom platform or self-hosted infrastructure.',
	},
};

const STACK_LANGUAGE_TAGS: ProjectStackTag[] = [
	ProjectStackTag.LanguagePHP,
	ProjectStackTag.LanguageJavaScript,
	ProjectStackTag.LanguagePython,
	ProjectStackTag.LanguageRuby,
	ProjectStackTag.LanguageOther,
];

const STACK_FRAMEWORKS_BY_LANGUAGE: Partial<Record<ProjectStackTag, ProjectStackTag[]>> = {
	[ProjectStackTag.LanguagePHP]: [
		ProjectStackTag.FrameworkLaravel,
		ProjectStackTag.FrameworkSymfony,
		ProjectStackTag.FrameworkYii2,
		ProjectStackTag.FrameworkCakePHP,
		ProjectStackTag.FrameworkCodeIgniter,
		ProjectStackTag.FrameworkPlainPHP,
	],
	[ProjectStackTag.LanguageJavaScript]: [
		ProjectStackTag.FrameworkNode,
		ProjectStackTag.FrameworkNext,
		ProjectStackTag.FrameworkRemix,
		ProjectStackTag.FrameworkNuxt,
		ProjectStackTag.FrameworkSvelteKit,
		ProjectStackTag.FrameworkAstro,
		ProjectStackTag.FrameworkSolidStart,
		ProjectStackTag.FrameworkVanillaJS,
	],
	[ProjectStackTag.LanguagePython]: [
		ProjectStackTag.FrameworkDjango,
		ProjectStackTag.FrameworkFastAPI,
		ProjectStackTag.FrameworkFlask,
		ProjectStackTag.FrameworkPlainPython,
	],
	[ProjectStackTag.LanguageRuby]: [
		ProjectStackTag.FrameworkRails,
		ProjectStackTag.FrameworkSinatra,
		ProjectStackTag.FrameworkPlainRuby,
	],
	[ProjectStackTag.LanguageOther]: [ProjectStackTag.FrameworkOther],
};

const STACK_PLATFORM_LARAVEL_TAGS: ProjectStackTag[] = [
	ProjectStackTag.PlatformLaravelVapor,
	ProjectStackTag.PlatformLaravelForge,
	ProjectStackTag.PlatformLaravelCloud,
];

const STACK_PLATFORM_COMMON_TAGS: ProjectStackTag[] = [
	ProjectStackTag.PlatformDockerCompose,
	ProjectStackTag.PlatformKubernetes,
	ProjectStackTag.PlatformAWS,
	ProjectStackTag.PlatformDigitalOcean,
	ProjectStackTag.PlatformVercel,
	ProjectStackTag.PlatformNetlify,
	ProjectStackTag.PlatformRender,
	ProjectStackTag.PlatformFlyIO,
	ProjectStackTag.PlatformSelfHosted,
];

const STACK_CATEGORY_LABELS: Record<ProjectStackCategory, string> = {
	language: 'Primary language',
	framework: 'Framework',
	platform: 'Platform / runtime',
};

const STACK_CATEGORY_OPTIONS: Record<ProjectStackCategory, ProjectStackTag[]> = {
	language: [...STACK_LANGUAGE_TAGS],
	framework: Array.from(
		new Set(
			Object.values(STACK_FRAMEWORKS_BY_LANGUAGE).reduce<ProjectStackTag[]>(
				(acc, tags) => acc.concat(tags),
				[],
			),
		),
	),
	platform: Array.from(new Set([...STACK_PLATFORM_LARAVEL_TAGS, ...STACK_PLATFORM_COMMON_TAGS])),
};

const PROVIDER_STACK_DEFAULTS: Record<DeploymentProvider, ProjectStackShape> = {
	[DeploymentProvider.LaravelCloud]: {
		language: ProjectStackTag.LanguagePHP,
		framework: ProjectStackTag.FrameworkLaravel,
		platform: ProjectStackTag.PlatformLaravelCloud,
	},
	[DeploymentProvider.LaravelForge]: {
		language: ProjectStackTag.LanguagePHP,
		framework: ProjectStackTag.FrameworkLaravel,
		platform: ProjectStackTag.PlatformLaravelForge,
	},
	[DeploymentProvider.LaravelVapor]: {
		language: ProjectStackTag.LanguagePHP,
		framework: ProjectStackTag.FrameworkLaravel,
		platform: ProjectStackTag.PlatformLaravelVapor,
	},
	[DeploymentProvider.Other]: {
		language: ProjectStackTag.LanguageOther,
		framework: ProjectStackTag.FrameworkOther,
		platform: ProjectStackTag.PlatformSelfHosted,
	},
};

export const projectStackCategories: ProjectStackCategory[] = ['language', 'framework', 'platform'];

export type ProjectStackChoice = {
	value: ProjectStackTag;
	label: string;
	description?: string;
};

function toChoice(tag: ProjectStackTag): ProjectStackChoice {
	return {
		value: tag,
		label: projectStackTagLabel(tag),
		description: projectStackTagDescription(tag),
	};
}

export function stackLanguageChoices(): ProjectStackChoice[] {
	return STACK_LANGUAGE_TAGS.map(toChoice);
}

export function stackFrameworkChoices(language?: ProjectStackTag): ProjectStackChoice[] {
	const tags =
		STACK_FRAMEWORKS_BY_LANGUAGE[language ?? ProjectStackTag.LanguageOther] ??
		STACK_FRAMEWORKS_BY_LANGUAGE[ProjectStackTag.LanguageOther] ??
		[];
	return tags.map(toChoice);
}

export function stackPlatformChoices(framework?: ProjectStackTag): ProjectStackChoice[] {
	const tags = [
		...(framework === ProjectStackTag.FrameworkLaravel ? STACK_PLATFORM_LARAVEL_TAGS : []),
		...STACK_PLATFORM_COMMON_TAGS,
	];
	return tags.map(toChoice);
}

export function projectStackTagLabel(tag: ProjectStackTag): string {
	return STACK_TAG_META[tag].label;
}

export function projectStackTagDescription(tag: ProjectStackTag): string {
	return STACK_TAG_META[tag].description;
}

export function projectStackCategoryLabel(category: ProjectStackCategory): string {
	return STACK_CATEGORY_LABELS[category];
}

export function projectStackCategoryOptions(category: ProjectStackCategory): ProjectStackTag[] {
	return STACK_CATEGORY_OPTIONS[category];
}

export function isProjectStackTag(value: unknown): value is ProjectStackTag {
	return (
		typeof value === 'string' &&
		Object.values(ProjectStackTag).includes(value as ProjectStackTag)
	);
}

export function suggestedStackForProvider(provider: DeploymentProvider): ProjectStackShape {
	return PROVIDER_STACK_DEFAULTS[provider] ?? {};
}
