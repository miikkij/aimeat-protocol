(function(AIMEAT) {
  'use strict';

  /**
   * RecipeCard — renders a compact recipe summary card.
   * @param {object} props
   * @param {object} props.recipe  — recipe object (title, description, cuisine, difficulty, prep_time_minutes, cook_time_minutes)
   * @param {function} [props.onClick] — callback when the card is clicked
   * @returns {HTMLElement}
   */
  function RecipeCard(props) {
    var recipe = props.recipe || {};
    var el = document.createElement('div');
    el.className = 'aimeat-recipe-card';
    el.setAttribute('data-cuisine', recipe.cuisine || '');
    el.setAttribute('data-difficulty', recipe.difficulty || '');

    var title = document.createElement('h3');
    title.textContent = recipe.title || 'Untitled Recipe';
    el.appendChild(title);

    if (recipe.description) {
      var desc = document.createElement('p');
      desc.className = 'recipe-description';
      desc.textContent = recipe.description;
      el.appendChild(desc);
    }

    var meta = document.createElement('div');
    meta.className = 'recipe-meta';
    if (recipe.prep_time_minutes != null) {
      var prep = document.createElement('span');
      prep.className = 'recipe-prep';
      prep.textContent = 'Prep: ' + recipe.prep_time_minutes + ' min';
      meta.appendChild(prep);
    }
    if (recipe.cook_time_minutes != null) {
      var cook = document.createElement('span');
      cook.className = 'recipe-cook';
      cook.textContent = 'Cook: ' + recipe.cook_time_minutes + ' min';
      meta.appendChild(cook);
    }
    if (recipe.difficulty) {
      var diff = document.createElement('span');
      diff.className = 'recipe-difficulty';
      diff.textContent = recipe.difficulty;
      meta.appendChild(diff);
    }
    el.appendChild(meta);

    if (typeof props.onClick === 'function') {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function() { props.onClick(recipe); });
    }

    return el;
  }

  /**
   * RecipeSearchForm — renders a search form with cuisine and text filters.
   * @param {object} props
   * @param {function} props.onSearch — callback({query, cuisine, difficulty})
   * @param {string[]} [props.cuisines] — available cuisine options
   * @returns {HTMLFormElement}
   */
  function RecipeSearchForm(props) {
    var cuisines = props.cuisines || ['italian', 'japanese', 'mexican', 'indian', 'french', 'thai', 'american', 'other'];
    var form = document.createElement('form');
    form.className = 'aimeat-recipe-search';

    var queryInput = document.createElement('input');
    queryInput.type = 'text';
    queryInput.name = 'query';
    queryInput.placeholder = 'Search recipes...';
    form.appendChild(queryInput);

    var cuisineSelect = document.createElement('select');
    cuisineSelect.name = 'cuisine';
    var defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'All cuisines';
    cuisineSelect.appendChild(defaultOpt);
    cuisines.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c.charAt(0).toUpperCase() + c.slice(1);
      cuisineSelect.appendChild(opt);
    });
    form.appendChild(cuisineSelect);

    var btn = document.createElement('button');
    btn.type = 'submit';
    btn.textContent = 'Search';
    form.appendChild(btn);

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      if (typeof props.onSearch === 'function') {
        props.onSearch({
          query: queryInput.value,
          cuisine: cuisineSelect.value || undefined,
        });
      }
    });

    return form;
  }

  /**
   * IngredientList — renders a list of ingredients with optional items marked.
   * @param {object} props
   * @param {Array} props.ingredients — array of {name, amount, unit, optional?}
   * @param {boolean} [props.showOptional=true] — whether to include optional ingredients
   * @returns {HTMLUListElement}
   */
  function IngredientList(props) {
    var ingredients = props.ingredients || [];
    var showOptional = props.showOptional !== false;
    var ul = document.createElement('ul');
    ul.className = 'aimeat-ingredient-list';

    ingredients.forEach(function(ing) {
      if (!showOptional && ing.optional) return;
      var li = document.createElement('li');
      var text = ing.amount;
      if (ing.unit) text += ' ' + ing.unit;
      text += ' ' + ing.name;
      if (ing.optional) text += ' (optional)';
      li.textContent = text;
      if (ing.optional) li.className = 'ingredient-optional';
      ul.appendChild(li);
    });

    return ul;
  }

  AIMEAT.register('recipe-ui', { RecipeCard: RecipeCard, RecipeSearchForm: RecipeSearchForm, IngredientList: IngredientList });
})(window.AIMEAT || (window.AIMEAT = {}));
