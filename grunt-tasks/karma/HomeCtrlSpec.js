define(['app', 'angular-mock'], function (app) {

    describe('app creation', function () {
        beforeEach(module('myApp'));
        var HomeCtrl,
            scope;

        // Initialize the controller and a mock scope
        beforeEach(angular.mock.inject(function ($controller, $rootScope) {
            scope = $rootScope.$new();
            HomeCtrl = $controller('HomeCtrl', {
                $scope: scope
            });
        }));


        it("The App should not be null", function () {
            expect(app).toBeDefined();
        });

        it ("Welcome message is:You are not authorized.", function () {
            expect(scope.welcome).toBe("You are not authorized.");
        });
    });

});