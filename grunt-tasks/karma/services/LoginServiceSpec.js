define(['app', 'angular-mock'], function (app) {

    describe('Login Service Observer', function () {
        beforeEach(module('myApp'));
        var loginService,
            timeout;

        // Initialize the controller and a mock scope
        beforeEach(angular.mock.inject(function ($timeout, LoginService) {
            loginService = LoginService;
            timeout = $timeout;
        }));


        it("Login service should register an observer", function () {
            loginService.registerForm(function () {
            });
            expect(loginService.observingForms.length).toBe(1);
        });

        it("LoginService should be able to do a callback", function () {
            var foo = {
                callback: function () {
                }
            };
            spyOn(foo, 'callback');
            loginService.registerForm(foo.callback);
            loginService.hideForm();
            timeout.flush();
            expect(foo.callback).toHaveBeenCalled();
        });


    });

});