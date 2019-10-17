import $ from 'jquery';

import bind from 'lodash/bind';
import clone from 'lodash/clone';
import each from 'lodash/each';
import extend from 'lodash/extend';
import first from 'lodash/first';
import has from 'lodash/has';
import includes from 'lodash/includes';
import isArray from 'lodash/isArray';
import isString from 'lodash/isString';
import keys from 'lodash/keys';
import map from 'lodash/map';
import mapValues from 'lodash/mapValues';

import hbTemplate from '../hb_templates/managePublications.hbs';
import pubListTemplate from '../hb_templates/publicationListFilter.hbs';

import PublicationListCollection from '../models/PublicationListCollection';

import AlertView from './AlertView';
import BaseView from './BaseView';
import SearchFilterRowView from './SearchFilterRowView';
import WarningDialogView from './WarningDialogView';

const DEFAULT_SELECT2_OPTIONS = {
    allowClear : true,
    theme : 'bootstrap'
};


const getFilters = function(model) {
    return mapValues(model.attributes, function(val) {
        var result;
        if (isString(val)) {
            result = val;
        } else if (isArray(val.selections)) {
            result = map(val.selections, function(selection) {
                return val.useId ? selection.id : selection.text;
            });
        } else { // must be a boolean
            result = val;
        }

        return result;
    });
};


export default BaseView.extend({
    events : {
        'change .page-size-select' : 'changePageSize',
        'click .clear-search-btn' : 'clearSearch',
        'click .search-btn' : 'filterPubs',
        'submit .pub-search-form' : 'filterPubs',
        'change #search-term-input' : 'changeQterm',
        'click .add-category-btn' : 'addFilterRow',
        'click .clear-advanced-search-btn' : 'clearFilterRows',
        'click .create-pub-btn' : 'goToEditPubPage',
        'click .manager-seriestitle-btn' : 'goToSeriesTitlePage',
        'click .manager-contribs-btn' : 'goToContributorPage',
        'click .add-to-lists-btn' : 'addSelectedPubsToCategory',
        'click .remove-from-list-btn' : 'removeSelectedPubsFromCategory',
        'change .pub-filter-list-div input[type="checkbox"]' : 'changePubsListFilter',
        'click .manager-affiliation-btn' : 'goToAffiliationManagement'
    },

    template: hbTemplate,

    /*
     * @param {Object} options
     *     @prop {String} el - jquery selector where the view should be rendered
     *     @prop {Backbone.Model} model - contains the current search filter parameters
     *     @prop {PublicationCollection} collection
     */
    initialize : function() {
        BaseView.prototype.initialize.apply(this, arguments);
        console.log('in initializse..');

        //Fetch publication lists
        this.publicationListCollection = new PublicationListCollection();
        this.pubListFetch = this.publicationListCollection.fetch();

        // Create filter model, listeners, and holder for filter rows.
        this.listenTo(this.model, 'change:q', this.updateQTerm);
        this.listenTo(this.model, 'change:listId', this.updatePubsListFilter);
        this.listenTo(this.model, 'change:listId', this.updateVisibilityRemoveFromPubListBtn);
        this.filterRowViews = [];

        // Can get rid of this once the edit contributors page is implemented.
        this.context.oldMyPubsEndpoint = window.CONFIG.oldMyPubsEndpoint;

        // Set up collection event handlers and then fetch the collection
        this.listenTo(this.collection, 'request', this.showLoadingIndicator);
        this.listenTo(this.collection, 'sync', this.updatePubsListDisplay);

        this.collection.updateFilters(getFilters(this.model));
        this.fetchPromise = this.collection.fetch({reset: true});

        var fromRawLookup = function(rawValue) {
            return rawValue ? rawValue.text : '';
        };
        var sortValueLookup = function(model, colName) {
            return fromRawLookup(model.get(colName), model);
        };
        var sortValueText = function(model, colName) {
            return model.has(colName) ? model.get(colName) : '';
        };

        var fromRawFirstAuthor = function(rawValue) {
            if (rawValue && has(rawValue, 'authors') && isArray(rawValue.authors) && rawValue.authors.length > 0) {
                return rawValue.authors[0].text;
            } else {
                return '';
            }
        };
        var sortValueFirstAuthor = function(model, colName) {
            return fromRawFirstAuthor(model.get(colName));
        };

        // Initialize a new Grid instance
        this.grid = new Backgrid.Grid({
            body : BackgridClientSortingBody,
            columns: columns,
            collection: this.collection,
            className : 'backgrid table-striped table-hover table-bordered'
        });

        // Initialize the paginator
        window.jQuery.pagination(this.$('.pub-pagination'),  {
             dataSource: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15 , 195],
             callback: function(data, pagination) {
                 // template method of yourself
                 //var html = template(data);
                 this.$('pub-grid-footer').html("<p> test </p>");
             }
        });


        // Create other child views
        this.alertView = new AlertView({
            el: '.alert-container'
        });

        this.warningDialogView = new WarningDialogView({
            el : '.warning-dialog-container'
        });
    },

    render : function() {
        var self = this;
        console.log('in render..');

        this.context.qTerm = this.model.has('q') ? this.model.get('q') : '';
        BaseView.prototype.render.apply(this, arguments);

        // Set the elements for child views and render if needed.
        this.alertView.setElement(this.$('.alert-container'));
        this.warningDialogView.setElement(this.$('.warning-dialog-container')).render();

        // Render the paginator
        //this.$('.pub-grid-footer').append(this.paginator.render().el);

        //Create any search filter rows
        each(keys(this.model.omit(['listId', 'q'])), bind(this._createFilterRow, this));

        // Initialize the publication lists select2 and filter
        this.pubListFetch.then(function() {
            var listFilter = self.model.has('listId') ? map(self.model.get('listId').selections, 'id') : [];
            var pubList = map(self.publicationListCollection.toJSON(), function(pubList) {
                var result = clone(pubList);
                if (includes(listFilter, JSON.stringify(result.id))) {
                    result.checked = true;
                }
                return result;
            });
            self.$('#pubs-categories-select').select2(extend({
                data : pubList
            }, DEFAULT_SELECT2_OPTIONS));
            self.$('.pub-filter-list-div').html(pubListTemplate({pubList : pubList}));
            self.updateVisibilityRemoveFromPubListBtn();
        });

        this.fetchPromise.fail(function(jqXhr) {
            self.alertView.showDangerAlert('Can\'t retrieve the list of publications: ' + jqXhr.statusText);
        }).always(function() {
            self.updatePubsListDisplay();
        });

        // check to see if a publication list filter is selected
        this.updateVisibilityRemoveFromPubListBtn();

        return this;
    },

    renderPublicationsPane : function() {
   	    let $pubList = this.$('.pub-pane');
   	    let maxItems = 4;  // TODO testing remove

        if(this.collection.length < maxItems) {
            maxItems = this.collection.length;
        }
        console.log('max items ' + maxItems);
        console.log('collections size ' + this.collection.length);
        console.log('collections state ' + this.collection.state);

        let dataHtml = '<H3><b>Publications</b></H3><br>';
        let publication;
        let sep = '';
        for(let i=0; i < maxItems; i++)  {
             publication = this.collection.at(i);
             var propValue;
             	for(var propName in publication) {
             	    propValue = publication[propName]
             	    console.log(propName,propValue);
             	}
             dataHtml += sep;
             const title = '<i>' + publication.attributes['title'] + '</i>';
             const url = '/publication/' + publication.attributes['indexId'];

             dataHtml += '<a href=' + url + '>' + title + '</a>';
             dataHtml += this.formatPublicationAuthors(i);
             dataHtml += this.formatPublicationEditors(i);
             dataHtml += this.formatPublicationAbstract(i);
             sep = '<hr>';
        }

   	    $pubList.html(dataHtml);
   },

    formatPublicationAuthors : function(collectionIndex) {
        let publication = this.collection.at(collectionIndex);
        let dataHtml = '';
        let sep = '';

        const authors = publication.attributes['contributors']['authors'];
        if (typeof authors !== 'undefined') {
            dataHtml += '<br>';
            authors.forEach(function (author) {
                dataHtml += sep + ' ' + author['text'];
                sep = ',';
            });
        }

        return dataHtml;
    } ,

    formatPublicationEditors : function(collectionIndex) {
        let publication = this.collection.at(collectionIndex);
        let dataHtml = '';
        let sep = '';

        const editors = publication.attributes['contributors']['editors'];
        if (typeof editors !== 'undefined') {
            dataHtml += '<br>';
            editors.forEach(function (editor) {
                dataHtml += sep + ' ' + editor['text'];
                sep = ',';
            });

            dataHtml += ', editor(s)';
        }

        return dataHtml;
    },

    formatPublicationAbstract : function(collectionIndex) {
        let publication = this.collection.at(collectionIndex);
        let dataHtml = '';
        let sep = '';

        const abstract = publication.attributes['contributors']['editors'];
        if (typeof abstract !== 'undefined') {
            dataHtml += '<br>';
            dataHtml += '<p>' + abstract + '</p>';
        }

        return dataHtml;
    },

    remove : function() {
        this.grid.remove();
        this.paginator.remove();
        this.alertView.remove();
        this.warningDialogView.remove();
        each(this.filterRowViews, function(view) {
            view.remove();
        });

        BaseView.prototype.remove.apply(this, arguments);
        return this;
    },

    _createFilterRow : function(initialCategory) {
        var $rowContainer = this.$('.advanced-search-rows-container');
        var newRow = new SearchFilterRowView({
            el: '.filter-row-container',
            model: this.model,
            initialCategory: initialCategory
        });
        $rowContainer.append('<div class="filter-row-container"></div>');
        this.$('.advanced-search-rows-container').append('<div ');
        newRow.setElement($rowContainer.find('.filter-row-container:last-child')).render();
        this.filterRowViews.push(newRow);
    },

    /*
     * DOM event handlers
     */

    clearSearch : function() {
        this.model.clear({silent : true});
        // No events will be fired so update DOM directly.
        this.updateQTerm();
        this.updatePubsListFilter();
        each(this.filterRowViews, function(rowView) {
            rowView.remove();
        });

        this.filterPubs();
    },

    filterPubs : function(ev) {
        var self = this;
        if (ev) {
            ev.preventDefault();
        }
        this.collection.updateFilters(getFilters(this.model));
        this.collection.getFirstPage()
                .fail(function(jqXhr) {
                    self.alertView.showDangerAlert('Can\'t retrieve the list of publications: ' + jqXhr.statusText);
                });
        window.sessionStorage.searchFilters = JSON.stringify(this.model.attributes);
    },

    changePageSize : function(ev) {
        this.collection.setPageSize(parseInt(ev.currentTarget.value));
    },

    changeQterm : function(ev) {
        this.model.set('q', ev.currentTarget.value);
    },

    addFilterRow : function(ev) {
        ev.preventDefault();
        this._createFilterRow();
    },

    clearFilterRows : function(ev) {
        ev.preventDefault();
        each(this.filterRowViews, function(view) {
            view.remove();
        });
        this.filterRowViews = [];
    },

    goToEditPubPage : function (ev) {
        ev.preventDefault();
        this.router.navigate('publication', {trigger: true});
    },

    goToSeriesTitlePage : function(ev) {
        ev.preventDefault();
        this.router.navigate('seriesTitle', {trigger: true});
    },

    goToContributorPage : function(ev) {
        ev.preventDefault();
        this.router.navigate('contributor', {trigger: true});
    },

    goToAffiliationManagement : function(ev) {
        ev.preventDefault();
        this.router.navigate('affiliation', {trigger: true});
    },

    addSelectedPubsToCategory : function(ev) {
        var self = this;

        var selectedPubs = this.collection.filter(function(model) {
            return model.has('selected') && model.get('selected');
        });
        var pubsIdData = $.param({
            publicationId : map(selectedPubs, function(model) {
                return model.get('id');
            })
        }, true);
        var pubsList = this.$('#pubs-categories-select').val();
        var addDeferreds = [];
        var serviceUrl = window.CONFIG.scriptRoot + '/manager/services/lists/';

        ev.preventDefault();

        if (!selectedPubs || selectedPubs.length === 0) {
            this.warningDialogView.show(
                'Select Publications',
                'You must select at least one publication to add to the list(s)'
            );
        } else if (!pubsList || pubsList.length === 0) {
            this.warningDialogView.show(
                'Select Lists',
                'You must select at least one publication list'
            );
        } else {
            addDeferreds = map(pubsList, function (pubListId) {
                return $.ajax({
                    url: serviceUrl + pubListId + '/pubs?' + pubsIdData,
                    method: 'POST'
                });
            });
            $.when.apply(this, addDeferreds)
                .done(function() {
                    self.alertView.showSuccessAlert('Selected publications successfully added to the chosen lists');
                })
                .fail(function() {
                    self.alertView.showDangerAlert('Error: Unable to add selected publications to the chosen lists');
                });
        }
    },

    removeSelectedPubsFromCategory: function() {
        var self = this;
        var selectedFilter = first(getFilters(this.model).listId);
        var serviceUrl = window.CONFIG.scriptRoot + '/manager/services/lists/' + selectedFilter;
        var selectedPubs = this.collection.filter(function(model) {
            return model.has('selected') && model.get('selected');
        });
        // get publication ids from selectedPubs
        var selectedPubIds = map(selectedPubs, 'id');
        // execute the delete requests
        var removeDeferreds = [];
        if (selectedPubIds.length === 0) {
            this.warningDialogView.show(
                'Select Publications',
                'You must select at least one publication to remove from the current filter list.'
            );
        } else {
            removeDeferreds = map(selectedPubIds, function(selectedPubId) {
                var targetUrl = serviceUrl + '/pubs/' + selectedPubId;
                return $.ajax({
                    url: targetUrl,
                    method: 'DELETE'
                });
            });
        }
        $.when.apply(this, removeDeferreds)
            .done(function() {
                self.alertView.showSuccessAlert('Selected publications successfully removed from the current list.');
            })
            .fail(function() {
                self.alertView.showDangerAlert('Error: Unable to remove the selected publications from the current list.');
            });
    },

    changePubsListFilter : function() {
        var pubsListFilter = [];
        this.$('.pub-filter-list-div input:checked').each(function() {
            pubsListFilter.push({
                id: $(this).val()
            });
        });
        this.model.set('listId', {useId : true, selections : pubsListFilter});
        this.filterPubs();
    },

    /*
     * Model event handlers
     */
    updateQTerm : function() {
        var qTerm = this.model.has('q') ? this.model.get('q') : '';
        this.$('#search-term-input').val(qTerm);
    },
    updatePubsListFilter : function() {
        var pubsList = this.model.has('listId') ? map(this.model.get('listId').selections, 'id') : [];

        this.$('.pub-filter-container input[type="checkbox"]').each(function() {
            $(this).prop('checked', includes(pubsList, $(this).val()));
        });
    },

    updateVisibilityRemoveFromPubListBtn : function() {
        // ternary handles initial render when listId doesn't exist
        var selectedFilters = getFilters(this.model).listId ? getFilters(this.model).listId : [];
        var $removePubBtn = this.$('.remove-from-list-btn');
        var selectedFilter;
        var selectedText;
        if (selectedFilters.length === 1 && this.publicationListCollection.size() > 0) {
            selectedFilter = first(selectedFilters);
            selectedText = this.publicationListCollection.findWhere({id : parseInt(selectedFilter)}).get('text');
            $removePubBtn.html('Remove Selected Publications From "' + selectedText + '" List');
            $removePubBtn.show();
        } else {
            $removePubBtn.hide();
        }
    },

    /* collection event handlers */
    showLoadingIndicator : function() {
        this.$('.pubs-loading-indicator').show();
    },

    updatePubsListDisplay : function() {
        this.$('.pubs-loading-indicator').hide();
        this.renderPublicationsPane();
        this.$('.pubs-count').html(this.collection.state.totalRecords);
    }
});
