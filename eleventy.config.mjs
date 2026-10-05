import { resolve } from 'node:path';
import site from './config/site.mjs';
import { categories, technologies, icons } from './config/categories.mjs';
import { readSnapshot, decorateRepositories } from './lib/repositories.mjs';

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ images: 'images', 'src/assets': 'assets' });
  eleventyConfig.addWatchTarget('./config/');
  eleventyConfig.addWatchTarget('./data/');
  eleventyConfig.setNunjucksEnvironmentOptions({ autoescape: true });
  eleventyConfig.addFilter('dateLabel', value => value ? new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(value)) : 'Not available');
  eleventyConfig.addFilter('numberLabel', value => new Intl.NumberFormat('en-GB').format(value ?? 0));
  eleventyConfig.addGlobalData('site', site);
  eleventyConfig.addGlobalData('icons', icons);
  eleventyConfig.addGlobalData('catalog', async () => {
    const snapshot = await readSnapshot(resolve('data/repositories.json'), site.owner);
    const repositories = decorateRepositories(snapshot);
    const categoryData = categories.map(category => ({ ...category,
      repositories: repositories.filter(repo => repo.categoryIds.includes(category.id)) }));
    const technologyData = technologies.map(technology => ({ ...technology,
      categories: categoryData.filter(category => category.technology === technology.id),
      repositories: repositories.filter(repo => categoryData.some(category => category.technology === technology.id && repo.categoryIds.includes(category.id)))
    }));
    return { repositories, categories: categoryData, technologies: technologyData,
      technologyPages: technologyData.filter(technology => technology.id !== 'other'), fetchedAt: snapshot.fetchedAt,
      stale: Date.now() - Date.parse(snapshot.fetchedAt) > 48 * 60 * 60 * 1000,
      totalStars: repositories.reduce((sum, repo) => sum + (repo.stars ?? 0), 0),
      templateCount: repositories.filter(repo => repo.isTemplate).length };
  });
  const prefix = process.env.SITE_PATH_PREFIX || '/';
  if (!/^\/(?:[a-zA-Z0-9._-]+\/)*$/.test(prefix)) throw new Error('SITE_PATH_PREFIX must be / or a slash-delimited repository path.');
  return { dir: { input: 'src', includes: '_includes', output: '_site' },
    templateFormats: ['njk'], htmlTemplateEngine: 'njk', pathPrefix: prefix };
}